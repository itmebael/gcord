/* Keep one text reader warm and serialize jobs to limit memory use on phones. */
(function () {
  var workerPromise = null, queue = Promise.resolve(), logger = null;

  function prepare() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('eng', 1, {
        logger: function (message) { if (logger) logger(message); }
      });
      var pending = workerPromise;
      pending.catch(function () { if (workerPromise === pending) workerPromise = null; });
    }
    return workerPromise;
  }

  function recognize(image, options) {
    var job = queue.then(async function () {
      var timer, pending;
      logger = options && options.logger;
      try {
        pending = prepare();
        return await Promise.race([
          pending.then(function (worker) { return worker.recognize(image); }),
          new Promise(function (_, reject) {
            timer = setTimeout(function () {
              // Terminate a stuck worker so later scans can start a fresh reader.
              if (workerPromise === pending) workerPromise = null;
              pending.then(function (worker) { return worker.terminate(); }).catch(function () {});
              reject(new Error('Receipt text reading timed out'));
            }, 20000);
          })
        ]);
      } catch (error) {
        if (pending && workerPromise === pending) {
          workerPromise = null;
          pending.then(function (worker) { return worker.terminate(); }).catch(function () {});
        }
        throw error;
      } finally {
        clearTimeout(timer);
        logger = null;
      }
    });
    queue = job.catch(function () {});
    return job;
  }

  window.GcordScannerOCR = { prepare: prepare, recognize: recognize };
})();
