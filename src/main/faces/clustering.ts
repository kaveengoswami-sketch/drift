import * as db from '../database'

const SIMILARITY_THRESHOLD = 0.65 // Cosine similarity threshold for same identity (0.65 = distance <= 0.35)

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

export function runClustering(): { clustersCreated: number; facesAssigned: number } {
  const rows = db.getAllFaceEmbeddings()
  if (!rows.length) {
    return { clustersCreated: 0, facesAssigned: 0 }
  }

  // Convert BLOB embeddings to normalized Float32Arrays
  const faceItems = rows.map((r) => ({
    id: r.id,
    photoId: r.photoId,
    personId: r.personId,
    personName: r.personName,
    embedding: bufferToFloat32Array(r.embedding)
  }))

  // 1. Group named people and compute their average centroids
  const namedCentroids = new Map<number, { centroid: Float32Array; count: number }>()
  for (const item of faceItems) {
    if (item.personId !== null && item.personName) {
      let entry = namedCentroids.get(item.personId)
      if (!entry) {
        entry = { centroid: new Float32Array(512), count: 0 }
        namedCentroids.set(item.personId, entry)
      }
      for (let i = 0; i < 512; i++) {
        entry.centroid[i] += item.embedding[i]
      }
      entry.count++
    }
  }

  // Normalize named centroids
  for (const entry of namedCentroids.values()) {
    if (entry.count > 0) {
      l2Normalize(entry.centroid)
    }
  }

  let facesAssigned = 0
  const unassigned: typeof faceItems = []

  // 2. Assign faces to nearest named person if similarity >= THRESHOLD
  for (const item of faceItems) {
    // If face is already locked to a named person, keep it
    if (item.personId !== null && item.personName) {
      continue
    }

    let bestPersonId: number | null = null
    let maxSim = -1

    for (const [pid, entry] of namedCentroids.entries()) {
      const sim = dotProduct(item.embedding, entry.centroid)
      if (sim > maxSim) {
        maxSim = sim
        bestPersonId = pid
      }
    }

    if (bestPersonId !== null && maxSim >= SIMILARITY_THRESHOLD) {
      db.assignFaceToPerson(item.id, bestPersonId)
      item.personId = bestPersonId
      facesAssigned++
    } else {
      unassigned.push(item)
    }
  }

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

  // 4. Update cover face for all people
  const allPeople = db.listPeople()
  for (const person of allPeople) {
    if (!person.coverFaceId) {
      const faces = db.listFacesForPhoto(person.id) // check faces for this person
      const topFace = db.getDb().prepare(
        'SELECT id FROM faces WHERE personId = ? ORDER BY confidence DESC, bboxW * bboxH DESC LIMIT 1'
      ).get(person.id) as { id: number } | undefined
      if (topFace) {
        db.updatePersonCoverFace(person.id, topFace.id)
      }
    }
  }

  return { clustersCreated, facesAssigned }
}
