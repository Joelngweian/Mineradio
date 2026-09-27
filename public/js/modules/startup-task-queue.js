function createStartupTaskQueue(options) {
  options = options || {};
  var schedule = typeof options.schedule === 'function'
    ? options.schedule
    : function(callback, delay) { setTimeout(callback, delay || 0); };
  var onError = typeof options.onError === 'function' ? options.onError : function() {};
  var pending = new Map();

  function enqueue(key, task, delay) {
    if (!key || typeof task !== 'function') return Promise.resolve();
    if (pending.has(key)) return pending.get(key);

    var completion = new Promise(function(resolve) {
      schedule(function() {
        Promise.resolve()
          .then(task)
          .catch(function(error) { onError(error, key); })
          .finally(function() {
            pending.delete(key);
            resolve();
          });
      }, delay || 0);
    });
    pending.set(key, completion);
    return completion;
  }

  function has(key) {
    return pending.has(key);
  }

  return { enqueue: enqueue, has: has };
}

export { createStartupTaskQueue };
