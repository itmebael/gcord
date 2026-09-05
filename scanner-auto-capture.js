/* Require receipt text as well as image quality. This is not authenticity verification. */
window.isAutoCaptureReceipt = function(data) {
  if(!data || !Number.isFinite(data.confidence) || data.confidence < 65) return false;
  var text=String(data.text||''), parsed=GcordTransactions.parseGCashText(text);
  return /\bg\s*cash\b/i.test(text) && /\bref(?:erence)?\b/i.test(text)
    && /\b(?:amount|total|sent|paid|payment|received)\b/i.test(text)
    && /^\d{13}$/.test(parsed.ref) && Number(parsed.amount)>0 && !!parsed.date && !!parsed.time;
};
window.createScannerAutoCapture = function(video, frame, hint, toggle, capture, available) {
  var canvas=document.createElement('canvas');canvas.width=90;canvas.height=160;
  var ctx=canvas.getContext('2d',{willReadFrequently:true}),timer,previous,ready=0,fired=false;
  var generation=0,checking=false,nextCheck=0,approved=null,anchor=null;
  function invalidate(){generation++;ready=0;approved=null;anchor=null;frame.classList.remove('capture-ready');}
  function reset(){previous=null;invalidate();}
  function stop(){clearInterval(timer);reset();}
  async function inspect(w,h,gray){
    if(!window.Tesseract){hint.textContent='Receipt detection unavailable. Use Capture or Upload.';return;}
    checking=true;anchor=gray.slice();var token=generation;
    hint.textContent='Checking for a GCash receipt…';
    try{
      var shot=document.createElement('canvas'),scale=Math.min(1,1400/h);
      shot.width=Math.max(1,Math.round(w*scale));shot.height=Math.max(1,Math.round(h*scale));
      shot.getContext('2d').drawImage(video,(video.videoWidth-w)/2,(video.videoHeight-h)/2,w,h,0,0,shot.width,shot.height);
      var image=shot.toDataURL('image/jpeg',.95),result=await Tesseract.recognize(image,'eng');
      if(token!==generation||!toggle.checked||!available()||document.hidden||fired)return;
      if(window.isAutoCaptureReceipt(result.data)){
        approved={image:image,at:performance.now()};frame.classList.add('capture-ready');hint.textContent='Receipt detected — hold still to capture.';
      }else{anchor=null;hint.textContent='No readable GCash receipt detected. Show its reference, amount and date.';}
    }catch(error){if(token===generation)hint.textContent='Could not read the receipt. Reposition it or use Capture.';}
    finally{checking=false;nextCheck=performance.now()+3000;}
  }
  function tick(){
    if(fired||!toggle.checked||document.hidden||!available()||video.readyState<2){reset();return;}
    try{
      var ratio=video.clientWidth/video.clientHeight,w=video.videoWidth,h=video.videoHeight;
      if(!ratio||!w||!h){reset();return;}
      if(w/h>ratio)w=h*ratio;else h=w/ratio;
      ctx.drawImage(video,(video.videoWidth-w)/2,(video.videoHeight-h)/2,w,h,0,0,90,160);
      var pixels=ctx.getImageData(0,0,90,160).data,gray=new Float32Array(14400),total=0,squares=0,motion=0,edges=0,clipped=0;
      for(var i=0;i<gray.length;i++){
        var v=.299*pixels[i*4]+.587*pixels[i*4+1]+.114*pixels[i*4+2];gray[i]=v;total+=v;squares+=v*v;if(v>250)clipped++;
        if(previous)motion+=Math.abs(v-previous[i]);
        if(i%90&&i>=90)edges+=Math.abs(v-gray[i-1])+Math.abs(v-gray[i-90]);
      }
      var n=gray.length,mean=total/n,contrast=Math.sqrt(Math.max(0,squares/n-mean*mean));
      var drift=0;if(anchor)for(var j=0;j<n;j++)drift+=Math.abs(gray[j]-anchor[j]);
      var steady=!!previous&&motion/n<4&&(!anchor||drift/n<6);previous=gray;
      var lit=mean>55&&mean<235&&clipped/n<.65,clear=contrast>24&&edges/(n*2)>7;
      if(!lit||!clear||!steady){invalidate();hint.textContent=!lit?'Adjust lighting to reduce darkness or glare.':!clear?'Move closer and let the camera focus.':'Hold the receipt steady.';return;}
      if(!ready)ready=performance.now();
      if(approved){if(performance.now()-approved.at>=1200){var image=approved.image;fired=true;stop();capture(image);}return;}
      if(!checking&&performance.now()>=nextCheck&&performance.now()-ready>=1200)inspect(w,h,gray);
    }catch(error){stop();hint.textContent='Auto capture unavailable. Use Capture or Upload.';}
  }
  toggle.addEventListener('change',function(){reset();hint.textContent=toggle.checked?'Hold the receipt steady for auto capture.':'Auto capture off. Use Capture when ready.';});
  document.addEventListener('visibilitychange',reset);
  return {start:function(){stop();fired=false;timer=setInterval(tick,250);},stop:stop};
};
