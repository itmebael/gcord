(function () {
  'use strict';
  var rows = [], dates, page = 0, size = 15;
  var money = new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'});
  var body = document.getElementById('staffReportRows'), download = document.getElementById('downloadStaffReport');
  var filter = document.getElementById('reportPeriod'), form = document.getElementById('reportFilters');
  var from = document.getElementById('reportFrom'), to = document.getElementById('reportTo');
  var notice = document.getElementById('reportFilterStatus'), dialog = document.getElementById('staffReportDetails');
  function empty(message) { body.replaceChildren(); var tr=document.createElement('tr'),td=document.createElement('td'); td.colSpan=4;td.textContent=message;tr.appendChild(td);body.appendChild(tr); }
  function details(row) {
    var fields = document.getElementById('staffReportDetailFields'); fields.replaceChildren();
    [['Reference number',row.ref_no],['Recipient',row.recipient_name],['GCash number',row.recipient_number],['Amount',money.format(row.amount)],['Receipt date',row.txn_date],['Receipt time',row.txn_time],['Status',row.status === 'duplicate' ? 'Duplicate' : 'Verified'],['Source',row.source]].forEach(function(item){
      var term=document.createElement('dt'), value=document.createElement('dd'); term.textContent=item[0];value.textContent=item[1] || 'Unavailable';fields.append(term,value);
    });
    dialog.showModal();
  }
  function render() {
    body.replaceChildren();
    rows.slice(page*size,(page+1)*size).forEach(function(row){
      var tr=document.createElement('tr');
      [row.ref_no,money.format(row.amount),row.status === 'duplicate' ? 'Duplicate' : 'Verified'].forEach(function(value,index){var td=document.createElement('td');td.textContent=value; if(index===2) td.className=row.status==='duplicate'?'report-duplicate':'report-verified';tr.appendChild(td);});
      var td=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='earnings-button';button.textContent='View details';button.setAttribute('aria-label','View details for reference '+row.ref_no);button.addEventListener('click',function(){details(row);});td.appendChild(button);tr.appendChild(td);body.appendChild(tr);
    });
    if(!rows.length) empty('No transactions in the selected period.');
    document.getElementById('reportPrev').disabled=page===0;
    document.getElementById('reportNext').disabled=(page+1)*size>=rows.length;
    document.getElementById('reportPage').textContent='Page '+(page+1)+' of '+Math.max(1,Math.ceil(rows.length/size));
  }
  window.addEventListener('staff-report-loading',function(){
    rows=[];download.disabled=true;dialog.close();empty('Loading transactions...');
    ['reportTotal','reportVerified','reportDuplicates','reportAmount'].forEach(function(id){document.getElementById(id).textContent='—';});
    document.getElementById('reportPrev').disabled=document.getElementById('reportNext').disabled=true;
    notice.textContent='Updating the chart, totals and transactions...';
  });
  window.addEventListener('staff-report-data',function(event){
    rows=event.detail.rows; dates=event.detail.dates; page=0;
    var verified=rows.filter(function(row){return row.status==='verified';});
    document.getElementById('reportTotal').textContent=rows.length;
    document.getElementById('reportVerified').textContent=verified.length;
    document.getElementById('reportDuplicates').textContent=rows.filter(function(row){return row.status==='duplicate';}).length;
    document.getElementById('reportAmount').textContent=money.format(verified.reduce(function(sum,row){return sum+Math.round(Number(row.amount)*100);},0)/100);
    notice.textContent=dates.start+' to '+dates.end+' · Receipt dates';
    document.getElementById('reportListCaption').textContent=rows.length+' transactions · '+dates.start+' to '+dates.end;
    if(!from.value) {from.value=dates.start;to.value=dates.end;}
    download.disabled=false;render();
  });
  window.addEventListener('staff-report-error',function(event){empty(event.detail);notice.textContent=event.detail;});
  function apply() {
    if(filter.value==='Custom') {
      if(!form.reportValidity()) return;
      if(from.value>to.value) {notice.textContent='End date must be on or after start date.';return;}
      if((Date.parse(to.value)-Date.parse(from.value))/86400000>365) {notice.textContent='Choose a range of up to one year.';return;}
    }
    window.GcordReportTrend.load(filter.value,filter.value==='Custom'?{from:from.value,to:to.value}:undefined);
  }
  filter.addEventListener('change',function(){var custom=filter.value==='Custom';from.disabled=to.disabled=!custom;from.required=to.required=custom;document.getElementById('reportFromLabel').hidden=document.getElementById('reportToLabel').hidden=!custom;if(!custom)apply();else notice.textContent='Choose a date range and select Apply filter. Current results remain labeled with their applied dates.';});
  form.addEventListener('submit',function(event){event.preventDefault();apply();});
  document.getElementById('reportPrev').addEventListener('click',function(){if(page>0){page--;render();}});
  document.getElementById('reportNext').addEventListener('click',function(){if((page+1)*size<rows.length){page++;render();}});
  document.getElementById('closeReportDetails').addEventListener('click',function(){dialog.close();});
  dialog.addEventListener('click',function(event){if(event.target===dialog){var r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  download.addEventListener('click',function(){
    if(!dates||download.disabled)return;
    function cell(value){var text=String(value==null?'':value);if(/^\s*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
    var data=[['Reference','Receipt date','Receipt time','Amount (PHP)','Status']].concat(rows.map(function(row){return [row.ref_no,row.txn_date,row.txn_time,row.amount,row.status];}));
    var filename='transactions-'+dates.start+'-to-'+dates.end+'.csv';
    GcordExportPreview(data, filename, function () {
    var url=URL.createObjectURL(new Blob(['\uFEFF'+data.map(function(row){return row.map(cell).join(',');}).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    var link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);
    });
  });
})();
