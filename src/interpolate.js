const radians = Math.PI / 180;

function vector(point) {
  const longitude = point[0] * radians, latitude = point[1] * radians;
  return [Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// A great circle is undefined for exact antipodes. Choose the eastward tangent
// there, including at the poles, instead of nudging either endpoint. Otherwise
// use the plane through both endpoints; this avoids dividing a slerp by sin(pi).
export function interpolateCenter(from, to) {
  const start = from.slice(0, 2), end = to.slice(0, 2);
  const a = vector(start), b = vector(end), normal = cross(a, b);
  const length = Math.hypot(...normal);
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  const angle = Math.atan2(length, dot);
  const tangent = length > 1e-12 ? cross(normal, a).map(value => value / length) :
    [-Math.sin(start[0] * radians), Math.cos(start[0] * radians), 0];
  return function(t) {
    if (t <= 0) return start.slice();
    if (t >= 1) return end.slice();
    const point = length <= 1e-12 && dot > 0 ?
      a.map((value, index) => value * (1 - t) + b[index] * t) :
      a.map((value, index) => value * Math.cos(angle * t) + tangent[index] * Math.sin(angle * t));
    return [Math.atan2(point[1], point[0]) / radians,
      Math.atan2(point[2], Math.hypot(point[0], point[1])) / radians];
  };
}
