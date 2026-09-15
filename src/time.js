// Dates crossing the API are instants. Calendar fields are UTC fields of a
// shifted Date, never host-local fields (which have DST gaps and overlaps).
export function isValidTimezone(offset) {
  return typeof offset === "number" && Number.isFinite(offset) && Math.abs(offset) <= 840;
}

export function toWallTime(instant, offset) {
  return new Date(instant.valueOf() + offset * 60000);
}

export function fromWallTime(wall, offset) {
  return new Date(wall.valueOf() - offset * 60000);
}

// One outstanding result owns the display offset. Superseded replies and
// replies after unmount cannot write state, even if the resolver ignores abort.
export function createTimezoneLookup(lifecycle, accept) {
  let generation = 0, previous;
  return function refresh(position, date, config, explicit = false) {
    const timestamp = Math.floor(date.valueOf() / 1000);
    const key = [position[0], position[1], timestamp, config.timezoneResolver,
      config.timezoneid, config.settimezone, explicit];
    if (previous && key.every((value, index) => value === previous[index])) return;
    previous = key;
    const request = ++generation;
    if (explicit || config.settimezone === false || lifecycle.disposed) return;
    const estimate = Math.round(position[1] / 15) * 60;
    function finish(offset) {
      if (request !== generation || lifecycle.disposed) return;
      accept(isValidTimezone(offset) ? offset : estimate);
    }
    if (typeof config.timezoneResolver === "function") {
      Promise.resolve().then(() => config.timezoneResolver(position[0], position[1], timestamp))
        .then(finish, () => finish(estimate));
    } else if (config.timezoneid) {
      const url = "https://api.timezonedb.com/v2.1/get-time-zone?format=json&by=position" +
        "&key=" + encodeURIComponent(config.timezoneid) + "&lat=" + position[0] +
        "&lng=" + position[1] + "&time=" + timestamp;
      lifecycle.load(url, (error, json) => {
        finish(!error && json.status !== "FAILED" ? json.gmtOffset / 60 : estimate);
      });
    } else {
      finish(estimate);
    }
  };
}
