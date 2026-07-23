import * as db from '../database'

/** Blind clustering: how alike two *unlabelled* faces must be to be called one person. */
const SIMILARITY_THRESHOLD = 0.65 // Cosine similarity threshold for same identity (0.65 = distance <= 0.35)

/**
 * How alike a cluster must be to a named person before it is folded in.
 *
 * Tuned against this library after the move to w600k_r50 with landmark
 * alignment, where same-person pairs average 0.78 and unrelated faces 0.09 —
 * the two populations barely overlap, so a plain threshold separates them.
 * Clusters verified by eye as the same person scored down to 0.54; clusters
 * verified as different people scored 0.38 and below. 0.50 sits in that gap.
 *
 * This replaced a rule comparing a cluster's similarity to its own internal
 * cohesion, which was measured against the older, far weaker embeddings. That
 * rule had a fatal flaw: it defined cohesion as similarity to the *nearest*
 * cluster-mate, so a burst of near-identical frames scored 1.0 and became
 * impossible to absorb. The tighter and more obviously-one-person a cluster
 * was, the harder it was to match — exactly backwards.
 */
const NAMED_CLUSTER_SIM = 0.5

/** Same bar for a lone face that has no cluster of its own. */
const NAMED_FACE_SIM = 0.5

/**
 * With two or more named people, a cluster must clearly prefer one of them.
 * Guards against pulling faces off one named person onto another.
 */
const RUNNERUP_MARGIN = 0.05

/**
 * Only a strong match earns the right to become an exemplar itself. Without
 * this gate a marginal absorption widens the model, which admits the next
 * marginal face, and the identity drifts off the person entirely — measured
 * at 743 wrong faces claimed in 6 rounds before it was added.
 */
const TRUST_SIM = 0.7

/** Each absorption widens the model, so the pass repeats until it settles. */
const MAX_LEARNING_ROUNDS = 4

/**
 * How many labelled faces a named person keeps as exemplars. The point of the
 * spread is pose and lighting coverage, and a few dozen frames already span
 * most of a person's range — past that the samples are near-duplicates of ones
 * already held, while every extra exemplar costs another 512-wide dot product
 * on every candidate face, every model, every round.
 */
const MAX_EXEMPLARS = 32

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i]
  }
  return sum
}

function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i]
  }
  const norm = Math.sqrt(sum)
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) {
      v[i] /= norm
    }
  }
  return v
}

function bufferToFloat32Array(buf: Buffer): Float32Array {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const copy = new Float32Array(f32.length)
  copy.set(f32)
  return l2Normalize(copy)
}

interface FaceItem {
  id: number
  photoId: number
  personId: number | null
  personName: string | null
  embedding: Float32Array
}

interface NamedModel {
  personId: number
  name: string
  centroid: Float32Array
  /** A spread of individual labelled faces, not just their average. */
  exemplars: Float32Array[]
}

/** Build one model per named person from the faces currently assigned to them. */
function buildNamedModels(items: FaceItem[]): NamedModel[] {
  const byPerson = new Map<number, { name: string; embs: Float32Array[] }>()
  for (const it of items) {
    if (it.personId === null || !it.personName) continue
    let entry = byPerson.get(it.personId)
    if (!entry) {
      entry = { name: it.personName, embs: [] }
      byPerson.set(it.personId, entry)
    }
    entry.embs.push(it.embedding)
  }

  const models: NamedModel[] = []
  for (const [personId, entry] of byPerson) {
    const centroid = new Float32Array(512)
    for (const e of entry.embs) {
      for (let i = 0; i < 512; i++) centroid[i] += e[i]
    }
    l2Normalize(centroid)

    // Evenly spaced rather than the first N: keeps the full range of poses
    // in the sample instead of whichever frames happen to be indexed first.
    const step = Math.max(1, Math.ceil(entry.embs.length / MAX_EXEMPLARS))
    const exemplars: Float32Array[] = []
    for (let i = 0; i < entry.embs.length; i += step) exemplars.push(entry.embs[i])

    models.push({ personId, name: entry.name, centroid, exemplars })
  }
  return models
}

/**
 * How strongly a face belongs to a named identity.
 *
 * This is the nearest labelled *example*, not the distance to the average.
 * A face turned three-quarters away can sit well outside a person's mean
 * embedding while being very close to another three-quarters shot of the
 * same person — and those are precisely the frames that got split into a
 * separate cluster, so scoring against the mean alone can never recover them.
 */
function scoreAgainst(model: NamedModel, emb: Float32Array): number {
  let best = dotProduct(emb, model.centroid)
  for (const ex of model.exemplars) {
    const s = dotProduct(emb, ex)
    if (s > best) best = s
  }
  return best
}

export function runClustering(): { clustersCreated: number; facesAssigned: number } {
  const rows = db.getAllFaceEmbeddings()
  if (!rows.length) {
    return { clustersCreated: 0, facesAssigned: 0 }
  }

  // Convert BLOB embeddings to normalized Float32Arrays
  // Defensive: the query already filters these out, but a single unusable
  // embedding taking down the whole scan is not a trade worth making.
  const faceItems: FaceItem[] = []
  for (const r of rows) {
    if (!r.embedding || r.embedding.byteLength < 512 * 4) continue
    faceItems.push({
      id: r.id,
      photoId: r.photoId,
      personId: r.personId,
      personName: r.personName,
      embedding: bufferToFloat32Array(r.embedding)
    })
  }
  if (!faceItems.length) return { clustersCreated: 0, facesAssigned: 0 }

  let facesAssigned = 0

  // 1-2. Learn from the names that already exist.
  //
  // Naming a cluster is a labelled example, and this is where that label is
  // put to work: every round rebuilds each named person's model from the
  // faces currently assigned to them, so anything absorbed in one round
  // sharpens the model for the next. Name one pile of Kaveen and his other
  // piles come in over successive passes.
  //
  // Only faces that matched overwhelmingly are allowed to shape the model
  // (see TRUST_SIM) — otherwise the loop runs away and claims strangers.
  const trusted = new Set<number>()
  for (const item of faceItems) {
    if (item.personId !== null && item.personName) trusted.add(item.id)
  }

  for (let round = 0; round < MAX_LEARNING_ROUNDS; round++) {
    const models = buildNamedModels(faceItems.filter((it) => trusted.has(it.id)))
    if (!models.length) break

    // Decide cluster by cluster, not face by face. An existing cluster is
    // real signal — those faces were grouped because they already look alike
    // — so evidence about one of them is evidence about all of them.
    const groups = new Map<number | string, FaceItem[]>()
    for (const item of faceItems) {
      if (item.personId !== null && item.personName) continue
      const key = item.personId ?? `loose:${item.id}`
      let g = groups.get(key)
      if (!g) groups.set(key, (g = []))
      g.push(item)
    }

    let changed = 0

    for (const group of groups.values()) {
      // Best-matching named person for this group as a whole.
      let winner: NamedModel | null = null
      let winnerMean = -1
      const simsByModel = new Map<number, number[]>()
      for (const m of models) {
        const sims = group.map((item) => scoreAgainst(m, item.embedding))
        simsByModel.set(m.personId, sims)
        const mean = sims.reduce((a, b) => a + b, 0) / group.length
        if (mean > winnerMean) {
          winnerMean = mean
          winner = m
        }
      }
      if (!winner) continue

      // Runner-up check: only meaningful once more than one person is named.
      let runnerUp = -1
      for (const m of models) {
        if (m.personId === winner.personId) continue
        const sims = simsByModel.get(m.personId) as number[]
        const mean = sims.reduce((x, y) => x + y, 0) / group.length
        if (mean > runnerUp) runnerUp = mean
      }

      const bar = group.length > 1 ? NAMED_CLUSTER_SIM : NAMED_FACE_SIM
      const isSamePerson =
        winnerMean >= bar && (runnerUp < 0 || winnerMean >= runnerUp + RUNNERUP_MARGIN)

      if (!isSamePerson) continue

      const sims = simsByModel.get(winner.personId) as number[]
      group.forEach((item, k) => {
        if (item.personId !== winner.personId) {
          db.assignFaceToPerson(item.id, winner.personId)
          item.personId = winner.personId
          item.personName = winner.name
          facesAssigned++
          changed++
        }
        if (sims[k] >= TRUST_SIM) trusted.add(item.id)
      })
    }

    if (!changed) break
  }

  const unassigned = faceItems.filter((it) => !(it.personId !== null && it.personName))

  // 3. Cluster remaining unassigned faces (DBSCAN / Connected components)
  const visited = new Set<number>()
  let clustersCreated = 0

  for (let i = 0; i < unassigned.length; i++) {
    const itemA = unassigned[i]
    if (visited.has(itemA.id)) continue

    const cluster: typeof faceItems = [itemA]
    visited.add(itemA.id)

    for (let j = i + 1; j < unassigned.length; j++) {
      const itemB = unassigned[j]
      if (visited.has(itemB.id)) continue

      const sim = dotProduct(itemA.embedding, itemB.embedding)
      if (sim >= SIMILARITY_THRESHOLD) {
        cluster.push(itemB)
        visited.add(itemB.id)
      }
    }

    // Reuse existing unnamed personId if any face in cluster has one, else create a new Person
    let targetPersonId: number | null = null
    for (const member of cluster) {
      if (member.personId !== null) {
        targetPersonId = member.personId
        break
      }
    }

    if (targetPersonId === null) {
      targetPersonId = db.createPerson(null, 'human')
      clustersCreated++
    }

    for (const member of cluster) {
      if (member.personId !== targetPersonId) {
        db.assignFaceToPerson(member.id, targetPersonId)
        member.personId = targetPersonId
        facesAssigned++
      }
    }
  }

  // 4. Re-pick every person's cover face.
  //
  // Recomputed unconditionally, not just when one is missing: absorbing more
  // faces into a person often brings in a better frame than the one that
  // happened to be there first, and the cover is what the People grid shows.
  const pickCover = db.getDb().prepare(
    'SELECT id FROM faces WHERE personId = ? ORDER BY confidence DESC, bboxW * bboxH DESC LIMIT 1'
  )
  for (const person of db.listPeople()) {
    const topFace = pickCover.get(person.id) as { id: number } | undefined
    if (topFace && topFace.id !== person.coverFaceId) {
      db.updatePersonCoverFace(person.id, topFace.id)
    }
  }

  // 5. Score every still-unnamed person against the named models.
  //
  // The People view only surfaces an unnamed cluster by default past a face
  // count, but a small cluster that clearly favours a named person is worth
  // showing anyway — most likely it's a pose or lighting gap that kept it
  // from folding in above. Anything scoring >= NAMED_CLUSTER_SIM already got
  // absorbed in step 1-2, so what's left here is by definition below that
  // bar; this just records how close it came.
  const finalModels = buildNamedModels(faceItems.filter((it) => it.personId !== null && it.personName))
  const unnamedByPerson = new Map<number, Float32Array[]>()
  for (const item of faceItems) {
    if (item.personId === null || item.personName) continue
    let embs = unnamedByPerson.get(item.personId)
    if (!embs) unnamedByPerson.set(item.personId, (embs = []))
    embs.push(item.embedding)
  }
  for (const [personId, embs] of unnamedByPerson) {
    if (!finalModels.length) {
      db.updatePersonSimilarityToNamed(personId, null)
      continue
    }
    const centroid = new Float32Array(512)
    for (const e of embs) {
      for (let i = 0; i < 512; i++) centroid[i] += e[i]
    }
    l2Normalize(centroid)
    let best = -1
    for (const m of finalModels) {
      const s = scoreAgainst(m, centroid)
      if (s > best) best = s
    }
    db.updatePersonSimilarityToNamed(personId, best)
  }

  // A rename/merge can drain every face out of a person row (its identity was
  // folded into another one above); leaving it behind would show up as a
  // "0 photos" ghost card in the People view.
  db.deleteEmptyPeople()

  return { clustersCreated, facesAssigned }
}
