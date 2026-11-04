// Meldung, falls die Supabase-Bibliothek nicht geladen werden konnte (z. B. offline beim ersten Start)
window.addEventListener('error', function (e) {
  if (String(e.message || '').indexOf('supabase-lib-missing') === -1) return;
  var box = document.createElement('div');
  box.className = 'center-state';
  var inner = document.createElement('div');
  inner.style.padding = '24px';
  inner.textContent = 'Familienzeit konnte nicht geladen werden. Bitte Internetverbindung prüfen und neu laden.';
  box.appendChild(inner);
  document.getElementById('app').replaceChildren(box);
});
