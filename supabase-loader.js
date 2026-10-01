/* Fallback loader for the Supabase browser SDK. */
(function (global) {
  if (global.supabase && typeof global.supabase.createClient === 'function') return;
  if (!global.document || !global.document.write) return;

  global.document.write(
    '<script src="https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js"><\/script>'
  );
})(window);
