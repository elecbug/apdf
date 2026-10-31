export function defaultTextureSeed(points, page = 1) {
  const [x, y] = points[0];
  return (Math.imul(Math.floor(x * 100 + 0.5), 73856093) ^ Math.imul(Math.floor(y * 100 + 0.5), 19349663) ^ Math.imul(page, 83492791) ^ 0x9e3779b9) >>> 0;
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hash(value) {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function noise(position, seed) {
  const index = Math.floor(position);
  let fraction = position - index;
  fraction *= fraction * (3 - 2 * fraction);
  const a = hash(index ^ seed), b = hash((index + 1) ^ seed);
  return a + (b - a) * fraction;
}

function strokePath(input) {
  const points = [input[0]], distances = [0];
  for (const point of input.slice(1)) {
    const previous = points[points.length - 1];
    const distance = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    if (distance > 1e-9) {
      points.push(point);
      distances.push(distances[distances.length - 1] + distance);
    }
  }
  const length = distances[distances.length - 1];
  function at(distance, offset = 0) {
    if (length === 0) return [points[0][0], points[0][1] + offset];
    let low = 0, high = distances.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (distances[middle] <= distance) low = middle + 1; else high = middle;
    }
    const index = Math.min(Math.max(low - 1, 0), points.length - 2);
    const [start, end] = points.slice(index, index + 2);
    const segment = distances[index + 1] - distances[index];
    const fraction = Math.max(0, Math.min((distance - distances[index]) / segment, 1));
    const dx = end[0] - start[0], dy = end[1] - start[1];
    return [start[0] + dx * fraction - dy / segment * offset, start[1] + dy * fraction + dx / segment * offset];
  }
  return { length, at };
}

export function texturePaths(stroke, surface) {
  const { points, width } = stroke;
  const path = strokePath(points);
  const seed = stroke.seed ?? defaultTextureSeed(points, stroke.page ?? 1);
  const next = random(seed), groups = new Map();
  function add(line, size, alpha) {
    const key = `${size}:${alpha}`;
    if (!groups.has(key)) groups.set(key, { width: width * size, alpha, paths: [] });
    groups.get(key).paths.push(line);
  }
  function pigment(line, sizeValue, alphaValue) {
    const size = surface.sizes[Math.min(Math.floor(sizeValue * surface.sizes.length), surface.sizes.length - 1)];
    const alpha = surface.alphas[Math.min(Math.floor(alphaValue * surface.alphas.length), surface.alphas.length - 1)];
    add(line, size, alpha);
  }
  add(points, surface.base_width, surface.base_alpha);
  if (path.length === 0) {
    for (let i = 0; i < surface.tap_marks; i += 1) {
      const angle = next() * Math.PI * 2;
      const radius = Math.sqrt(next()) * width * 0.43;
      pigment([[points[0][0] + Math.cos(angle) * radius, points[0][1] + Math.sin(angle) * radius]], next(), next());
    }
  } else if (surface.kind === 'graphite') {
    const spacing = Math.max(width * 0.055, 0.18, path.length / 3500);
    let distance = next() * spacing;
    for (let i = 0; i < 4096 && distance < path.length; i += 1) {
      const length = width * (0.05 + next() * 0.25);
      const offset = (next() + next() - 1) * width * 0.48;
      const drift = (next() - 0.5) * width * 0.08;
      pigment([path.at(distance, offset), path.at(distance + length / 2, offset + drift / 2), path.at(distance + length, offset + drift)], next(), next());
      distance += spacing * (0.45 + next() * 1.1);
    }
  } else {
    const runScale = Math.max(1, path.length / (width * 140));
    const knotSpacing = Math.max(width * 0.2, 0.4, path.length / 1200);
    for (let lane = 0; lane < surface.bristles; lane += 1) {
      const laneSeed = (seed ^ Math.imul(lane + 1, 0x9e3779b9)) >>> 0;
      const bristle = random(laneSeed);
      const center = ((lane / (surface.bristles - 1) - 0.5) * 0.78 + (bristle() - 0.5) * 0.18) * width;
      const wanderScale = width * (1.2 + bristle() * 2);
      let distance = bristle() * width * 0.3;
      for (let i = 0; i < 256 && distance < path.length; i += 1) {
        const loading = 0.35 + noise(distance / (width * 6), seed) * 0.65;
        const run = width * (0.2 + bristle() ** 2 * 4) * (0.5 + loading * 1.3) * runScale;
        const end = Math.min(path.length, distance + run);
        const segments = Math.max(1, Math.ceil((end - distance) / knotSpacing));
        const mark = [];
        for (let j = 0; j <= segments; j += 1) {
          const position = distance + (end - distance) * j / segments;
          const offset = Math.max(-width * 0.46, Math.min(center + (noise(position / wanderScale, laneSeed) - 0.5) * width * 0.34, width * 0.46));
          mark.push(path.at(position, offset));
        }
        pigment(mark, bristle(), bristle() * 0.65 + loading * 0.35);
        const gap = width * (0.04 + bristle() ** 2 * 0.7) * (1.5 - loading) * runScale;
        distance = end + gap;
      }
    }
  }
  return [...groups.values()];
}
