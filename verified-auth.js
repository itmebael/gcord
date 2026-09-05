/* Supabase email/Google identity proof bridged to the existing application accounts. */
(function () {
  var identity;
  function client() {
    if (!identity) identity = supabase.createClient(GCORD_SUPABASE.url, GCORD_SUPABASE.anonKey, {
      auth: {storageKey:'gcord-verified-identity',flowType:'pkce',persistSession:true,detectSessionInUrl:true}
    });
    return identity;
  }
  function strong(password) {
    return password.length>=12 && new TextEncoder().encode(password).length<=72 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9\s]/.test(password);
  }
  function checkPassword(password) { if(!strong(password))throw new Error('Use at least 12 characters, uppercase, lowercase, a number and a special character (maximum 72 bytes).'); }
  function modal(title, html) {
    var d=document.createElement('dialog');d.className='identity-dialog';d.setAttribute('aria-label',title);
    var heading=document.createElement('h2');heading.textContent=title;d.appendChild(heading);
    var form=document.createElement('form');form.innerHTML=html+'<p class="identity-status" role="status" aria-live="polite"></p><div class="identity-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="identity-primary">Continue</button></div>';d.appendChild(form);document.body.appendChild(d);
    form.querySelector('[data-cancel]').onclick=function(){d.close();};d.showModal();return {dialog:d,form:form,status:form.querySelector('.identity-status'),submit:form.querySelector('[type="submit"]')};
  }
  async function verifyEmail(email, shouldCreateUser) {
    await client().auth.signOut({scope:'local'});
    var allowCreate=shouldCreateUser !== false;
    var sent=await client().auth.signInWithOtp({email:email,options:{shouldCreateUser:allowCreate}});
    if(sent.error && allowCreate && /signups? not allowed for otp/i.test(sent.error.message || '')) {
      throw new Error('Email OTP signup is disabled in Supabase. Enable Authentication > Providers > Email > Allow new users to sign up, then try again.');
    }
    if(sent.error)throw sent.error;
    return new Promise(function(resolve,reject){
      var ui=modal('Verify your email','<p>Enter the code sent to <strong data-email></strong>. Check your spam folder too.</p><label>Email code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" minlength="6" maxlength="10" required></label><button type="button" data-resend>Resend code</button>');
      ui.form.querySelector('[data-email]').textContent=email;ui.submit.textContent='Verify code';ui.form.elements.code.focus();
      var done=false,busy=false,lastSent=Date.now(),resend=ui.form.querySelector('[data-resend]');
      function lock(value){busy=value;ui.submit.disabled=value;resend.disabled=value;ui.form.querySelector('[data-cancel]').disabled=value;}
      ui.dialog.addEventListener('cancel',function(e){if(busy)e.preventDefault();});
      ui.dialog.addEventListener('close',function(){ui.dialog.remove();if(!done)reject(new DOMException('Verification cancelled.','AbortError'));});
      resend.onclick=async function(){
        if(Date.now()-lastSent<60000){ui.status.textContent='Please wait one minute before requesting another code.';return;}
        lock(true);try{var r=await client().auth.signInWithOtp({email:email,options:{shouldCreateUser:allowCreate}});if(r.error)throw r.error;lastSent=Date.now();ui.status.textContent='A new code has been sent.';}catch(e){ui.status.textContent=e.message;}finally{lock(false);}
      };
      ui.form.onsubmit=async function(e){e.preventDefault();if(busy)return;lock(true);ui.status.textContent='Checking code…';
        try{var r=await client().auth.verifyOtp({email:email,token:ui.form.elements.code.value.trim(),type:'email'});if(r.error)throw r.error;if(!r.data.session)throw new Error('Email verification did not complete. Request a new code.');done=true;ui.dialog.close();resolve();}
        catch(error){ui.status.textContent=error.message||'Invalid or expired code.';}finally{lock(false);}
      };
    });
  }
  async function rpc(name,args){var result=await client().rpc(name,args);if(result.error)throw result.error;return result.data;}
  async function signup(payload){
    checkPassword(payload.password);
    try {
      await verifyEmail(payload.email.trim(), true);
      var parts=payload.full_name.trim().split(/\s+/);
      return await rpc('app_complete_verified_signup',{p_details:{first_name:parts[0],last_name:parts.slice(1).join(' ')||parts[0],age:payload.age,birthday:payload.birthday,valid_id_url:payload.valid_id_url,face_capture_url:payload.face_capture_url,phone:payload.phone||null},p_password:payload.password});
    } finally {await client().auth.signOut({scope:'local'});}
  }
  function reset(){
    var ui=modal('Reset your password','<p>Verify your account email before setting a new password.</p><label>Email address<input name="email" type="email" autocomplete="email" required></label><label>New password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><label>Confirm password<input name="confirm" type="password" autocomplete="new-password" required></label><p>Use 12+ characters with uppercase, lowercase, a number and a special character.</p>');
    ui.submit.textContent='Send verification code';
    ui.dialog.addEventListener('close',function(){ui.dialog.remove();});
    ui.form.onsubmit=async function(e){e.preventDefault();if(ui.submit.disabled)return;
      var password=ui.form.elements.password.value,email=ui.form.elements.email.value.trim();
      try{checkPassword(password);if(password!==ui.form.elements.confirm.value)throw new Error('Passwords do not match.');}catch(error){ui.status.textContent=error.message;return;}
      ui.submit.disabled=true;ui.form.querySelector('[data-cancel]').disabled=true;
      try{await verifyEmail(email, false);await rpc('app_reset_verified_password',{p_password:password});GcordAPI.clearSession();ui.form.reset();ui.status.textContent='Password updated. Close this window and sign in with your new password.';ui.submit.hidden=true;}
      catch(error){ui.status.textContent=error.name==='AbortError'?'Verification cancelled. Your password was not changed.':error.message;}
      finally{await client().auth.signOut({scope:'local'});ui.submit.disabled=false;ui.form.querySelector('[data-cancel]').disabled=false;password='';}
    };
    ui.dialog.addEventListener('cancel',function(e){if(ui.submit.disabled)e.preventDefault();});
  }
  function message(text){var el=document.getElementById('loginError');el.textContent=text;el.style.display='block';}
  async function google(){
    var button=document.querySelector('.btn-google');button.disabled=true;
    try{var redirect=new URL('login.html',location.href);redirect.search='?google=1';var result=await client().auth.signInWithOAuth({provider:'google',options:{redirectTo:redirect.href,queryParams:{prompt:'select_account'}}});if(result.error)throw result.error;}
    catch(error){message(error.message);button.disabled=false;}
  }
  async function callback(){
    var params=new URLSearchParams(location.search);if(params.get('google')!=='1')return;
    message('Completing Google sign-in…');
    try{
      var result=await client().auth.getSession();if(result.error)throw result.error;
      if(!result.data.session)throw new Error('Google sign-in did not finish. Please try again.');
      var user=await rpc('app_login_verified_identity',{});GcordAPI.setSession(user);
      await client().auth.signOut({scope:'local'});location.replace(GcordAPI.isAdmin(user)?'admin-dashboard.html':'dashboard.html');
    }catch(error){message(error.message);await client().auth.signOut({scope:'local'});history.replaceState(null,'',location.pathname);}
  }
  window.GcordIdentity={signup:signup,checkPassword:checkPassword};
  document.querySelector('.forgot').addEventListener('click',reset);
  document.querySelector('.btn-google').addEventListener('click',google);
  callback();
})();
