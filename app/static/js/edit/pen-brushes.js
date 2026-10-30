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
