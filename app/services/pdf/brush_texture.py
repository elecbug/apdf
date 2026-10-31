from __future__ import annotations

import bisect
import math


def default_texture_seed(points: list, page: int = 1) -> int:
    x, y = points[0]
    return (math.floor(x * 100 + 0.5) * 73856093 ^ math.floor(y * 100 + 0.5) * 19349663 ^ page * 83492791 ^ 0x9E3779B9) & 0xFFFFFFFF


class _Random:
    def __init__(self, seed: int):
        self.state = seed

    def next(self) -> float:
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state / 4294967296


def _hash(value: int) -> float:
    value &= 0xFFFFFFFF
    value = ((value ^ (value >> 16)) * 0x7FEB352D) & 0xFFFFFFFF
    value = ((value ^ (value >> 15)) * 0x846CA68B) & 0xFFFFFFFF
    return (value ^ (value >> 16)) / 4294967296


def _noise(position: float, seed: int) -> float:
    index = math.floor(position)
    fraction = position - index
    fraction *= fraction * (3 - 2 * fraction)
    a, b = _hash(index ^ seed), _hash((index + 1) ^ seed)
    return a + (b - a) * fraction


class _StrokePath:
    def __init__(self, points: list):
        self.points = [points[0]]
        self.distances = [0.0]
        for point in points[1:]:
            distance = math.dist(self.points[-1], point)
            if distance > 1e-9:
                self.points.append(point)
                self.distances.append(self.distances[-1] + distance)
        self.length = self.distances[-1]

    def at(self, distance: float, offset: float = 0) -> tuple[float, float]:
        if self.length == 0:
            return self.points[0][0], self.points[0][1] + offset
        index = min(max(bisect.bisect_right(self.distances, distance) - 1, 0), len(self.points) - 2)
        start, end = self.points[index:index + 2]
        length = self.distances[index + 1] - self.distances[index]
        fraction = max(0, min((distance - self.distances[index]) / length, 1))
        dx, dy = end[0] - start[0], end[1] - start[1]
        return start[0] + dx * fraction - dy / length * offset, start[1] + dy * fraction + dx / length * offset


def texture_paths(points: list, width: float, surface: dict, seed: int) -> list[dict]:
    """Deterministic, arc-length-based pigment marks, shared with pen-texture.js."""
    path = _StrokePath(points)
    random = _Random(seed)
    groups: dict[tuple, dict] = {}

    def add(line: list, size: float, alpha: float):
        key = (size, alpha)
        if key not in groups:
            groups[key] = {"width": width * size, "alpha": alpha, "paths": []}
        groups[key]["paths"].append(line)

    add(points, surface["base_width"], surface["base_alpha"])
    sizes, alphas = surface["sizes"], surface["alphas"]

    def pigment(line: list, size_value: float, alpha_value: float):
        size = sizes[min(int(size_value * len(sizes)), len(sizes) - 1)]
        alpha = alphas[min(int(alpha_value * len(alphas)), len(alphas) - 1)]
        add(line, size, alpha)

    if path.length == 0:
        for _ in range(surface["tap_marks"]):
            angle = random.next() * math.tau
            radius = math.sqrt(random.next()) * width * 0.43
            x, y = points[0]
            pigment([(x + math.cos(angle) * radius, y + math.sin(angle) * radius)], random.next(), random.next())
    elif surface["kind"] == "graphite":
        spacing = max(width * 0.055, 0.18, path.length / 3500)
        distance = random.next() * spacing
        for _ in range(4096):
            if distance >= path.length:
                break
            length = width * (0.05 + random.next() * 0.25)
            offset = (random.next() + random.next() - 1) * width * 0.48
            drift = (random.next() - 0.5) * width * 0.08
            mark = [path.at(distance, offset), path.at(distance + length / 2, offset + drift / 2), path.at(distance + length, offset + drift)]
            pigment(mark, random.next(), random.next())
            distance += spacing * (0.45 + random.next() * 1.1)
    else:
        lanes = surface["bristles"]
        run_scale = max(1, path.length / (width * 140))
        knot_spacing = max(width * 0.2, 0.4, path.length / 1200)
        for lane in range(lanes):
            lane_seed = (seed ^ ((lane + 1) * 0x9E3779B9)) & 0xFFFFFFFF
            bristle = _Random(lane_seed)
            center = ((lane / (lanes - 1) - 0.5) * 0.78 + (bristle.next() - 0.5) * 0.18) * width
            wander_scale = width * (1.2 + bristle.next() * 2)
            distance = bristle.next() * width * 0.3
            for _ in range(256):
                if distance >= path.length:
                    break
                loading = 0.35 + _noise(distance / (width * 6), seed) * 0.65
                run = width * (0.2 + bristle.next() ** 2 * 4) * (0.5 + loading * 1.3) * run_scale
                end = min(path.length, distance + run)
                segments = max(1, math.ceil((end - distance) / knot_spacing))
                mark = []
                for index in range(segments + 1):
                    position = distance + (end - distance) * index / segments
                    offset = center + (_noise(position / wander_scale, lane_seed) - 0.5) * width * 0.34
                    offset = max(-width * 0.46, min(offset, width * 0.46))
                    mark.append(path.at(position, offset))
                pigment(mark, bristle.next(), (bristle.next() * 0.65 + loading * 0.35))
                gap = width * (0.04 + bristle.next() ** 2 * 0.7) * (1.5 - loading) * run_scale
                distance = end + gap
    return list(groups.values())
