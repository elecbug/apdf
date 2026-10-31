import { texturePaths } from './pen-texture.js?v=1';

const textureCache = new WeakMap();

function cachedTexture(stroke, surface) {
  const cached = textureCache.get(stroke);
  if (cached && cached.points === stroke.points && cached.count === stroke.points.length && cached.width === stroke.width && cached.seed === stroke.seed && cached.surface === surface) return cached.groups;
  const groups = texturePaths(stroke, surface);
  textureCache.set(stroke, { points: stroke.points, count: stroke.points.length, width: stroke.width, seed: stroke.seed, surface, groups });
  return groups;
}

function offsetPoints(points, offset) {
  return points.map(([x, y], index) => {
    const previous = points[Math.max(0, index - 1)];
    const following = points[Math.min(points.length - 1, index + 1)];
    const dx = following[0] - previous[0];
    const dy = following[1] - previous[1];
    const length = Math.hypot(dx, dy);
    const [nx, ny] = length > 1e-9 ? [-dy / length, dx / length] : [0, 1];
    return [x + nx * offset, y + ny * offset];
  });
}

export function drawPenStroke(context, stroke, presets) {
  const preset = presets[stroke.texture];
  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineJoin = 'round';
  context.lineCap = preset.cap;
  if (preset.surface) {
    context.setLineDash([]);
    for (const group of cachedTexture(stroke, preset.surface)) {
      context.lineWidth = group.width;
      context.globalAlpha = stroke.opacity * group.alpha;
      context.beginPath();
      let hasLines = false;
      for (const points of group.paths) {
        if (points.length === 1) {
          context.save();
          context.beginPath();
          context.arc(...points[0], group.width / 2, 0, Math.PI * 2);
          context.fill();
          context.restore();
        } else {
          hasLines = true;
          context.moveTo(...points[0]);
          points.slice(1).forEach(point => context.lineTo(...point));
        }
      }
      if (hasLines) context.stroke();
    }
    context.restore();
    return;
  }
  for (const layer of preset.layers) {
    const width = stroke.width * layer.width;
    context.lineWidth = width;
    context.globalAlpha = stroke.opacity * layer.alpha;
    context.setLineDash(layer.dash.map(value => value * stroke.width));
    context.lineDashOffset = layer.phase * stroke.width;
    const points = offsetPoints(stroke.points, layer.offset * stroke.width);
    context.beginPath();
    if (points.length === 1) {
      const [x, y] = points[0];
      if (preset.cap === 'butt') {
        context.rect(x - width / 2, y - width / 2, width, width);
      } else {
        context.arc(x, y, width / 2, 0, Math.PI * 2);
      }
      context.fill();
    } else {
      context.moveTo(...points[0]);
      points.slice(1).forEach(point => context.lineTo(...point));
      context.stroke();
    }
  }
  context.restore();
}
