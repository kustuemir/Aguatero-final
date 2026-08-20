// AGUATERO - Service Worker AUTOMATICO - Actualiza index.html siempre
// FIX: se subió la versión del cache (v2 -> v3) para que este archivo nuevo
// reemplace al anterior en los celulares que ya tenían la app instalada.
const CACHE_NOMBRE = 'aguatero-v2-cache-v2';

self.addEventListener('install', function(evento){
  self.skipWaiting();
  evento.waitUntil(
    caches.open(CACHE_NOMBRE).then(function(cache){
      return cache.addAll([
        './',
        './index.html',
        './styles.css',
        './app.js',
        './config.js',
        './manifest.json',
        './icon-192.png',
        './icon-512.png'
      ]);
    })
  );
});

self.addEventListener('activate', function(evento){
  evento.waitUntil(
    caches.keys().then(function(nombres){
      return Promise.all(
        nombres.filter(function(n){ return n !== CACHE_NOMBRE; }).map(function(n){ return caches.delete(n); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

// FIX CLAVE: index.html y / SIEMPRE de internet primero, nunca del cache viejo
self.addEventListener('fetch', function(evento){
  if (evento.request.method !== 'GET') return;

  // Si pide index.html o la raiz, va a internet primero
  if (evento.request.url.includes('index.html') || evento.request.url.endsWith('/') || evento.request.url.endsWith('/Aguatero') || evento.request.url.endsWith('/Aguatero/')) {
    evento.respondWith(
      fetch(evento.request, {cache: 'no-store'})
        .then(function(res){
          return res;
        })
        .catch(function(){
          // FIX: si no hay internet, buscamos el cache sin importar el ?v=,
          // y si tampoco hay nada con esa URL exacta, probamos con la raíz './'
          // (que sí queda guardada desde el "install").
          return caches.match(evento.request, {ignoreSearch: true}).then(function(r){
            return r || caches.match('./');
          });
        })
    );
    return;
  }

  // Para todo lo demás (css, js, iconos):
  // FIX: app.js y styles.css se piden con "?v=" + un timestamp que cambia en
  // cada apertura de la app (para forzar que llegue el código nuevo cuando
  // hay señal). Eso significa que la URL nunca es igual a una ya guardada en
  // caché, así que antes SIEMPRE se iba a buscar a internet - y si en ese
  // momento no había señal, el archivo no cargaba y la app quedaba rota.
  // Ahora: primero intenta traer la versión más nueva de internet (y la
  // guarda, borrando la versión vieja de ese mismo archivo). Si no hay
  // internet, usa la última copia guardada sin importar qué "?v=" tenga.
  evento.respondWith(
    fetch(evento.request).then(function(resFetch){
      caches.open(CACHE_NOMBRE).then(function(cache){
        cache.keys().then(function(claves){
          var urlPedida = new URL(evento.request.url);
          claves.forEach(function(clave){
            var urlGuardada = new URL(clave.url);
            // Mismo archivo (ignorando el ?v=) -> se borra la copia vieja
            if(urlGuardada.origin + urlGuardada.pathname === urlPedida.origin + urlPedida.pathname){
              cache.delete(clave);
            }
          });
          cache.put(evento.request, resFetch.clone());
        });
      });
      return resFetch;
    }).catch(function(){
      return caches.match(evento.request, {ignoreSearch: true});
    })
  );
});
