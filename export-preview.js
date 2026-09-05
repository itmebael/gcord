/* Review a snapshot of export data before starting a download. */
(function () {
  window.GcordExportPreview = function (rows, filename, confirm) {
    var dialog = document.createElement('dialog');
    dialog.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(960px,94vw);max-height:88vh;padding:24px;border:1px solid #dbe5ff;border-radius:22px;background:#f7faff;color:#18305b;box-sizing:border-box;box-shadow:0 24px 80px #122c6155';
    dialog.setAttribute('aria-label', 'Review download');
    var title = document.createElement('h2'); title.textContent = 'Review your report';
    var caption = document.createElement('p'); caption.textContent = filename;
    var scroller = document.createElement('div'); scroller.style.cssText = 'overflow:auto;max-height:55vh;background:white;border:1px solid #dbe5ff;border-radius:12px';
    var table = document.createElement('table'); table.style.cssText = 'border-collapse:collapse;width:100%;font-size:13px;text-align:left';
    rows.forEach(function (row, i) {
      var tr = document.createElement('tr');
      row.forEach(function (value) { var td = document.createElement(i ? 'td' : 'th'); td.textContent = value == null ? '' : String(value); td.style.cssText = 'padding:12px;border-bottom:1px solid #e3eaf7;white-space:nowrap'; tr.appendChild(td); });
      table.appendChild(tr);
    });
    scroller.appendChild(table);
    var actions = document.createElement('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:20px';
    var cancel = document.createElement('button'); cancel.textContent = 'Cancel';
    var save = document.createElement('button'); save.textContent = 'Download';
    [cancel,save].forEach(function (button) { button.type = 'button'; button.style.cssText = 'padding:12px 22px;border:1px solid #c7d6fc;border-radius:12px;font:inherit;cursor:pointer'; actions.appendChild(button); });
    save.style.background = '#2455df'; save.style.color = 'white';
    cancel.onclick = function () { dialog.close(); };
    save.onclick = function () { dialog.close(); confirm(); };
    var previous = document.activeElement;
    dialog.addEventListener('close', function () { dialog.remove(); if (previous) previous.focus(); });
    dialog.append(title,caption,scroller,actions); document.body.appendChild(dialog); dialog.showModal(); cancel.focus();
  };
})();
