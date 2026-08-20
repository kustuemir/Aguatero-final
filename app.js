// ---------- CONFIGURACION DE ESTA APLICACION ----------
const APP_CONFIG = window.AGUATERO_CONFIG || {};
const ADMIN_WHATSAPP = APP_CONFIG.supportWhatsapp || '';
const ADMIN_EMAIL = APP_CONFIG.supportEmail || 'trabajovideo2121@gmail.com';
const SUPABASE_URL = APP_CONFIG.supabaseUrl || '';
const SUPABASE_ANON_KEY = APP_CONFIG.supabaseAnonKey || '';
const FUNCIONES_URL = APP_CONFIG.paymentsFunctionsUrl || '';
const sb = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

let usuarioActual = null; // usuario autenticado
let usuarioEsAdmin = false;
let repartoActualId = null;

function supabaseConfigurado(){ return !!sb; }

// ---------- SINCRONIZACIÓN CON SUPABASE (respaldo en la nube) ----------
// Todas las funciones son silenciosas: si no hay internet, no interrumpen al usuario.
// Los datos se guardan igual en el celular (localStorage + IndexedDB).

function clienteToSupabase(c){
  return {
    id: c.id,
    user_id: usuarioActual.id,
    codigo: c.codigo,
    nombre: c.nombre,
    telefono: c.telefono || '',
    direccion: c.direccion || '',
    precio: c.precio || 0,
    precio10: c.precio10 || 0,
    precio_disp: c.precioDisp || 0,
    precio_soda: c.precioSoda || 0,
    precios_por_dia: c.preciosPorDia || {},
    dias: c.dias || [],
    saldo: c.saldo || 0,
    envases_pendientes: c.envasesPendientes || 0,
    saldo_a_favor: c.saldoAFavor || 0,
    orden_por_dia: c.ordenPorDia || {},
    nota: c.nota || '',
    activo: c.activo !== false
  };
}

function clienteFromSupabase(row, movimientos){
  return {
    id: row.id,
    codigo: row.codigo || 0,
    nombre: row.nombre,
    telefono: row.telefono || '',
    direccion: row.direccion || '',
    precio: parseFloat(row.precio) || 0,
    precio10: parseFloat(row.precio10) || 0,
    precioDisp: parseFloat(row.precio_disp) || 0,
    precioSoda: parseFloat(row.precio_soda) || 0,
    preciosPorDia: row.precios_por_dia || {},
    dias: row.dias || [],
    saldo: parseFloat(row.saldo) || 0,
    envasesPendientes: row.envases_pendientes || 0,
    saldoAFavor: parseFloat(row.saldo_a_favor) || 0,
    ordenPorDia: row.orden_por_dia || {},
    nota: row.nota || '',
    activo: row.activo !== false,
    historial: movimientos || []
  };
}

function movimientoPerteneceAlRepartoActual(entry){
  if(!entry) return false;
  if(repartoActualId && entry.repartoId) return entry.repartoId === repartoActualId;
  return !!fechaContadores && entry.fechaISO === fechaContadores;
}

function fechaOperativaActual(){
  return fechaContadores || todayISO();
}

function movimientoToSupabase(entry, clienteId){
  return {
    id: entry.id,
    user_id: usuarioActual.id,
    cliente_id: clienteId,
    tipo: entry.tipo,
    fecha_iso: entry.fechaISO,
    hora: entry.hora || '',
    b20: entry.b20 || 0,
    b10: entry.b10 || 0,
    disp: entry.disp || 0,
    soda: entry.soda || 0,
    bidones: entry.bidones || 0,
    envases: entry.envases || 0,
    env_soda: entry.envSoda || 0,
    costo: entry.costo || 0,
    forma_pago: entry.formaPago || '',
    monto_pagado: entry.montoPagado || 0,
    monto_aplicado_deuda: entry.montoAplicadoDeuda || 0,
    monto_saldo_favor: entry.montoSaldoFavor || 0,
    transferencia_confirmada: entry.transferenciaConfirmada || false,
    precios_aplicados: entry.preciosAplicados || {},
    reparto_id: entry.repartoId || repartoActualId || null,
    anulado: entry.anulado === true,
    anulado_en: entry.anuladoEn || null
  };
}

function movimientoFromSupabase(row){
  return {
    id: row.id,
    tipo: row.tipo,
    fechaISO: row.fecha_iso,
    hora: row.hora || '',
    b20: row.b20 || 0,
    b10: row.b10 || 0,
    disp: row.disp || 0,
    soda: row.soda || 0,
    bidones: row.bidones || 0,
    envases: row.envases || 0,
    envSoda: row.env_soda || 0,
    costo: parseFloat(row.costo) || 0,
    formaPago: row.forma_pago || '',
    montoPagado: parseFloat(row.monto_pagado) || 0,
    montoAplicadoDeuda: parseFloat(row.monto_aplicado_deuda) || 0,
    montoSaldoFavor: parseFloat(row.monto_saldo_favor) || 0,
    transferenciaConfirmada: row.transferencia_confirmada || false,
    preciosAplicados: row.precios_aplicados || {},
    repartoId: row.reparto_id || null,
    anulado: row.anulado === true,
    anuladoEn: row.anulado_en || null
  };
}

// ---------- SINCRONIZACIÓN V2 ----------
// Regla: ninguna operación comercial se descarta por fallos de red.
// Los movimientos usan su ID como clave idempotente: reintentar la misma
// operación no debe crear una segunda venta/pago.
function colaStorageKey(){
  return 'colaSyncPendiente_' + (usuarioActual && usuarioActual.id ? usuarioActual.id : 'sin_usuario');
}

function cargarColaSync(){
  try { return JSON.parse(localStorage.getItem(colaStorageKey()) || '[]'); }
  catch(e){ return []; }
}

var colaSyncPendiente = cargarColaSync();

function guardarColaSync(){
  localStorage.setItem(colaStorageKey(), JSON.stringify(colaSyncPendiente));
}

function eliminarDeColaSync(operacion){
  if(!operacion) return;
  const clave = claveOperacion(operacion);
  const antes = colaSyncPendiente.length;
  colaSyncPendiente = colaSyncPendiente.filter(x => claveOperacion(x) !== clave);
  if(colaSyncPendiente.length !== antes) guardarColaSync();
}

function claveOperacion(op){
  if(op.tipo === 'cliente') return 'cliente:' + (op.data && op.data.id);
  if(op.tipo === 'movimiento') return 'movimiento:' + (op.data && op.data.id);
  if(op.tipo === 'borrarMovimiento') return 'borrarMovimiento:' + op.entryId;
  if(op.tipo === 'actualizarMovimiento') return 'actualizarMovimiento:' + (op.data && op.data.id);
  if(op.tipo === 'borrarCliente') return 'borrarCliente:' + op.clienteId;
  if(op.tipo === 'stock') return 'stock:' + (usuarioActual && usuarioActual.id);
  if(op.tipo === 'resumen') return 'resumen:' + (usuarioActual && usuarioActual.id) + ':' + op.fecha;
  if(op.tipo === 'reparto') return 'reparto:' + (op.data && op.data.id);
  return op.tipo + ':' + JSON.stringify(op);
}

function snapshotStock(){ return JSON.parse(JSON.stringify(stockCamion || {})); }
function snapshotResumen(fecha){
  return {fecha:fecha,venta:ventaHoy,efectivo:efectivoHoy,transferencia:transferenciaHoy,deuda:deudaGeneradaHoy,cobroDeuda:cobroDeudaHoy,
    envasesEntregados:envasesEntregadosHoy,envasesRecibidos:envasesRecibidosHoy,
    b20Vendidos:b20VendidosHoy,b10Vendidos:b10VendidosHoy,dispVendidos:dispVendidosHoy,sodaVendidas:sodaVendidasHoy,
    visitas:visitasHoy.size};
}

function agregarAColaSync(operacion){
  if(!usuarioActual) return;
  const clave = claveOperacion(operacion);
  const existente = colaSyncPendiente.findIndex(x => claveOperacion(x) === clave);
  if(existente >= 0) colaSyncPendiente[existente] = {...colaSyncPendiente[existente], ...operacion};
  else colaSyncPendiente.push({...operacion, creadoEn: operacion.creadoEn || new Date().toISOString()});
  guardarColaSync();
  actualizarIndicadorSync();
}

async function syncCliente(c, desdeCola=false){
  if(!usuarioActual || !supabaseConfigurado()) return false;
  try{
    const { error } = await sb.from('clientes').upsert(clienteToSupabase(c), { onConflict:'id' });
    if(error) throw error;
    eliminarDeColaSync({tipo:'cliente',data:c});
    return true;
  }catch(e){
    console.warn('Sync cliente pendiente:', e.message || e);
    if(!desdeCola) agregarAColaSync({tipo:'cliente', data:c});
    return false;
  }
}

// En V2 un cliente se desactiva; nunca se borra su historial comercial.
async function syncBorrarCliente(clienteId, desdeCola=false){
  if(!usuarioActual || !supabaseConfigurado()) return false;
  try{
    const { error } = await sb.from('clientes')
      .update({activo:false})
      .eq('id',clienteId)
      .eq('user_id',usuarioActual.id);
    if(error) throw error;
    eliminarDeColaSync({tipo:'borrarCliente',clienteId});
    return true;
  }catch(e){
    if(!desdeCola) agregarAColaSync({tipo:'borrarCliente', clienteId});
    return false;
  }
}

function asegurarRepartoId(){
  if(!repartoActualId) repartoActualId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : generarId();
  return repartoActualId;
}

async function syncReparto(estado='abierto', fecha, desdeCola=false, repartoId=null){
  if(!usuarioActual || !supabaseConfigurado()) return false;
  const id=repartoId || repartoActualId || asegurarRepartoId();
  const data={
    id,
    user_id:usuarioActual.id,
    fecha:fecha||fechaContadores||todayISO(),
    estado,
    updated_at:new Date().toISOString(),
    closed_at:estado==='cerrado'?new Date().toISOString():null
  };
  try{
    const {error}=await sb.from('repartos').upsert(data,{onConflict:'id'});
    if(error) throw error;
    eliminarDeColaSync({tipo:'reparto',data:{id}});
    return true;
  }catch(e){
    if(!desdeCola) agregarAColaSync({tipo:'reparto',data});
    return false;
  }
}

async function syncMovimiento(entry, clienteId, desdeCola=false){
  if(!usuarioActual || !supabaseConfigurado()) return false;
  try{
    const repartoId = entry.repartoId || repartoActualId || asegurarRepartoId();
    entry.repartoId = repartoId;

    // Solo creamos/actualizamos el reparto como ABIERTO si esta operación
    // pertenece al reparto que actualmente está abierto en el dispositivo.
    // Una operación vieja que quedó pendiente después de cerrar el reparto
    // jamás debe reabrirlo al volver internet.
    if(repartoActualId === repartoId){
      const repartoOk = await syncReparto('abierto', entry.fechaISO || fechaContadores || todayISO(), desdeCola, repartoId);
      if(!repartoOk && navigator.onLine) throw new Error('No se pudo sincronizar el reparto');
    }

    const { error } = await sb.from('movimientos')
      .upsert(movimientoToSupabase(entry, clienteId), { onConflict:'id' });
    if(error) throw error;

    eliminarDeColaSync({tipo:'movimiento',data:entry,clienteId});
    eliminarDeColaSync({tipo:'actualizarMovimiento',data:entry,clienteId});
    return true;
  }catch(e){
    console.warn('Sync movimiento pendiente:', e.message || e);
    if(!desdeCola) agregarAColaSync({tipo:'movimiento', data:entry, clienteId});
    return false;
  }
}

async function syncBorrarMovimiento(entryId, desdeCola=false){
  // Producción: los movimientos nunca se borran físicamente; se anulan.
  if(!usuarioActual || !supabaseConfigurado()) return false;
  try{
    const { error } = await sb.from('movimientos')
      .update({anulado:true, anulado_en:new Date().toISOString()})
      .eq('id',entryId).eq('user_id',usuarioActual.id);
    if(error) throw error;
    eliminarDeColaSync({tipo:'borrarMovimiento',entryId});
    return true;
  }catch(e){
    if(!desdeCola) agregarAColaSync({tipo:'borrarMovimiento',entryId});
    return false;
  }
}

async function syncActualizarMovimiento(entry, clienteId, desdeCola=false){
  if(!usuarioActual || !supabaseConfigurado()) return false;
  try{
    entry.repartoId = entry.repartoId || repartoActualId || null;
    const { error } = await sb.from('movimientos')
      .upsert(movimientoToSupabase(entry,clienteId), { onConflict:'id' });
    if(error) throw error;
    eliminarDeColaSync({tipo:'actualizarMovimiento',data:entry,clienteId});
    eliminarDeColaSync({tipo:'movimiento',data:entry,clienteId});
    return true;
  }catch(e){
    console.warn('Actualización de movimiento pendiente:', e.message || e);
    if(!desdeCola) agregarAColaSync({tipo:'actualizarMovimiento',data:entry,clienteId});
    return false;
  }
}

async function syncStock(stockSnapshot, desdeCola=false){
  if(!usuarioActual || !supabaseConfigurado()) return false;
  const s = stockSnapshot || snapshotStock();
  try{
    const { error } = await sb.from('stock_camion').upsert({
      user_id:usuarioActual.id,b20:s.b20||0,b10:s.b10||0,disp:s.disp||0,
      soda:s.soda||0,vaciosb20:s.vaciosB20||0,vaciosb10:s.vaciosB10||0,vaciossoda:s.vaciosSoda||0
    },{onConflict:'user_id'});
    if(error) throw error;
    eliminarDeColaSync({tipo:'stock'});
    return true;
  }catch(e){
    console.warn('Stock pendiente:',e.message||e);
    if(!desdeCola) agregarAColaSync({tipo:'stock',data:s});
    return false;
  }
}

async function syncResumenDiario(fecha, resumenSnapshot, desdeCola=false){
  if(!usuarioActual || !supabaseConfigurado()) return false;
  const dia = fecha || todayISO();
  const r = resumenSnapshot || snapshotResumen(dia);
  try{
    const { error } = await sb.from('resumenes_diarios').upsert({
      user_id:usuarioActual.id,fecha:dia,venta:r.venta||0,efectivo:r.efectivo||0,
      transferencia:r.transferencia||0,deuda:r.deuda||0,envases_entregados:r.envasesEntregados||0,
      envases_recibidos:r.envasesRecibidos||0,b20_vendidos:r.b20Vendidos||0,b10_vendidos:r.b10Vendidos||0,
      disp_vendidos:r.dispVendidos||0,soda_vendidas:r.sodaVendidas||0,visitas:r.visitas||0,
      hora:new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})
    },{onConflict:'user_id,fecha'});
    if(error) throw error;
    eliminarDeColaSync({tipo:'resumen',fecha:dia});
    return true;
  }catch(e){
    console.warn('Resumen pendiente:',e.message||e);
    if(!desdeCola) agregarAColaSync({tipo:'resumen',fecha:dia,data:r});
    return false;
  }
}

async function procesarColaSync(){
  if(!usuarioActual || colaSyncPendiente.length===0) return;
  const pendientes = [...colaSyncPendiente];
  for(const op of pendientes){
    let ok=false;
    try{
      if(op.tipo==='cliente') ok=await syncCliente(op.data,true);
      else if(op.tipo==='movimiento') ok=await syncMovimiento(op.data,op.clienteId,true);
      else if(op.tipo==='borrarCliente') ok=await syncBorrarCliente(op.clienteId,true);
      else if(op.tipo==='borrarMovimiento') ok=await syncBorrarMovimiento(op.entryId,true);
      else if(op.tipo==='actualizarMovimiento') ok=await syncActualizarMovimiento(op.data,op.clienteId,true);
      else if(op.tipo==='stock') ok=await syncStock(op.data,true);
      else if(op.tipo==='resumen') ok=await syncResumenDiario(op.fecha,op.data,true);
      else if(op.tipo==='reparto'){ const r=await sb.from('repartos').upsert(op.data,{onConflict:'id'}); ok=!r.error; if(ok) eliminarDeColaSync(op); }
    }catch(e){ ok=false; }
    if(ok){
      const clave=claveOperacion(op);
      colaSyncPendiente=colaSyncPendiente.filter(x=>claveOperacion(x)!==clave);
      guardarColaSync();
    }
  }
  actualizarIndicadorSync();
}

function actualizarIndicadorSync(){
  const cantidad=colaSyncPendiente.length;
  const btnCargar=document.querySelector('button[onclick="renderTodo()"]');
  if(btnCargar){
    btnCargar.style.background=cantidad>0?'#e74c3c':'';
    btnCargar.title=cantidad>0?(cantidad+' operaciones pendientes de sincronizar'):'Actualizar datos';
  }
  const badge=document.getElementById('syncBadge');
  if(badge){ badge.style.display=cantidad>0?'block':'none'; badge.textContent=cantidad; }
}

window.addEventListener('online',()=>{ procesarColaSync(); });

// BAJAR TODOS LOS DATOS DE SUPABASE (al iniciar sesión en un celular nuevo)
async function descargarDatosSupabase(){
  if(!usuarioActual || !supabaseConfigurado()) return;
  try{
    // Traer el reparto abierto primero. En un celular nuevo, si hay uno abierto
    // en la nube, debe recuperarse antes de permitir empezar otro.
    const { data: repartoAbierto } = await sb.from('repartos').select('*')
      .eq('user_id', usuarioActual.id).eq('estado','abierto')
      .order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(repartoAbierto && !repartoActualId){
      repartoActualId = repartoAbierto.id;
      fechaContadores = repartoAbierto.fecha || fechaContadores || todayISO();
      fechaInicioTrabajo = fechaContadores;
    }

    // Traer clientes
    const { data: clientesData, error: errC } = await sb.from('clientes').select('*').eq('user_id', usuarioActual.id);
    if(errC) throw errC;

    // Traer movimientos no anulados para el estado operativo local.
    const { data: movsData, error: errM } = await sb.from('movimientos').select('*')
      .eq('user_id', usuarioActual.id).eq('anulado', false);
    if(errM) throw errM;

    // Traer stock
    const { data: stockData } = await sb.from('stock_camion').select('*').eq('user_id', usuarioActual.id).maybeSingle();

    // Agrupar movimientos por cliente
    const movsPorCliente = {};
    if(movsData){
      movsData.forEach(m => {
        if(!movsPorCliente[m.cliente_id]) movsPorCliente[m.cliente_id] = [];
        movsPorCliente[m.cliente_id].push(movimientoFromSupabase(m));
      });
    }

    // CORRECCIÓN: MERGE inteligente - actualizar maestros, conservar historial local
    if(clientes.length > 0){
      // Ya hay datos locales. Hacer merge por ID (actualizar maestros, conservar historial local)
      const idsLocales = new Set(clientes.map(c => c.id));
      clientesData.forEach(row => {
        const idx = clientes.findIndex(c => c.id === row.id);
        if(idx !== -1){
          // Actualizar datos base del cliente existente
          const localCliente = clientes[idx];
          localCliente.nombre = row.nombre;
          localCliente.telefono = row.telefono || '';
          localCliente.direccion = row.direccion || '';
          localCliente.precio = parseFloat(row.precio) || 0;
          localCliente.precio10 = parseFloat(row.precio10) || 0;
          localCliente.precioDisp = parseFloat(row.precio_disp) || 0;
          localCliente.precioSoda = parseFloat(row.precio_soda) || 0;
          localCliente.preciosPorDia = row.precios_por_dia || {};
          localCliente.dias = row.dias || [];
          localCliente.ordenPorDia = row.orden_por_dia || {};
          localCliente.nota = row.nota || '';
          localCliente.activo = row.activo !== false;
          // Unir historial local + nube por ID. Si hay operaciones pendientes
          // de este cliente, conservamos además su saldo/envases locales hasta
          // que la cola quede sincronizada.
          const idsHistorialLocal = new Set((localCliente.historial || []).map(h=>h.id));
          (movsPorCliente[row.id] || []).forEach(m=>{
            if(!idsHistorialLocal.has(m.id)) localCliente.historial.push(m);
          });
          const tienePendientesCliente = colaSyncPendiente.some(op =>
            (op.clienteId === row.id) || (op.data && op.data.id === row.id)
          );
          if(!tienePendientesCliente){
            localCliente.saldo = parseFloat(row.saldo) || 0;
            localCliente.envasesPendientes = row.envases_pendientes || 0;
          }
          localCliente.historial.sort((a,b)=>((a.fechaISO||'')+(a.hora||'')).localeCompare((b.fechaISO||'')+(b.hora||'')));
        } else {
          // Cliente nuevo
          clientes.push(clienteFromSupabase(row, movsPorCliente[row.id] || []));
        }
      });
      console.log('Merge: ', clientesData.length, 'clientes procesados de Supabase, ', clientes.length, 'total');
    } else {
      // No hay datos locales - descargar todo de Supabase (celular nuevo)
      clientes = clientesData.map(row => clienteFromSupabase(row, movsPorCliente[row.id] || []));
    }
    contadorClientes = clientes.reduce((max, c) => Math.max(max, c.codigo), 0);

    if(stockData && (!stockCamion.b20 && !stockCamion.b10 && !stockCamion.disp && !stockCamion.soda)){
      // Solo cargar stock de la nube si local está vacío
      stockCamion = { b20: stockData.b20 || 0, b10: stockData.b10 || 0, disp: stockData.disp || 0, soda: stockData.soda || 0, vaciosB20: stockData.vaciosb20 || 0, vaciosB10: stockData.vaciosb10 || 0, vaciosSoda: stockData.vaciossoda || 0 };
    }

    guardarEstado();
    renderTodo();
    console.log('Datos descargados de Supabase:', clientes.length, 'clientes');
  }catch(e){
    console.log('No se pudo descargar de Supabase:', e);
  }
}

function ocultarMensajesLogin(){
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('loginInfo').style.display = 'none';
}

function mostrarErrorLogin(msg){
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('loginInfo').style.display = 'none';
}

function mostrarInfoLogin(msg){
  const el = document.getElementById('loginInfo');
  el.textContent = msg;
  el.style.display = 'block';
  document.getElementById('loginError').style.display = 'none';
}

async function accionLogin(){
  ocultarMensajesLogin();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if(!email || !password){ mostrarErrorLogin('Completá el email y la contraseña.'); return; }

  const boton = document.getElementById('btnLoginAccion');
  boton.disabled = true;
  boton.textContent = 'Un momento...';

  try{
    if(!supabaseConfigurado()){ mostrarErrorLogin('La aplicación todavía no está conectada a su proyecto Supabase. Configurá config.js antes de iniciar sesión.'); return; }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if(error){ mostrarErrorLogin(traducirErrorSupabase(error)); return; }
    // "Recordarme": si lo desmarca, la próxima vez que abra la app le va a
    // volver a pedir usuario y contraseña en vez de entrar solo.
    const recordarme = document.getElementById('chkRecordarme');
    if(recordarme && !recordarme.checked){
      localStorage.setItem('aguatero_v2_no_recordar', '1');
    } else {
      localStorage.removeItem('aguatero_v2_no_recordar');
    }
    onLoginExitoso(data.session);
  }catch(e){
    mostrarErrorLogin('No se pudo conectar. Revisá que tengas internet e intentá de nuevo.');
  }finally{
    boton.disabled = false;
    boton.textContent = 'Ingresar';
  }
}

function traducirErrorSupabase(error){
  const msg = error.message || '';
  if(msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
  if(msg.includes('User already registered')) return 'Ya existe una cuenta con ese email. Probá "Ingresar".';
  if(msg.includes('Password should be')) return 'La contraseña es muy corta (mínimo 6 caracteres).';
  return 'Ocurrió un error: ' + msg;
}

// Mostrar/ocultar la contraseña con el ícono del ojito
function toggleMostrarPassword(){
  const input = document.getElementById('loginPassword');
  const btn = document.getElementById('btnTogglePassword');
  if(!input) return;
  if(input.type === 'password'){
    input.type = 'text';
    if(btn) btn.textContent = '🙈';
  } else {
    input.type = 'password';
    if(btn) btn.textContent = '👁️';
  }
}

// ---------- RECUPERAR CONTRASEÑA ----------
async function recuperarPassword(){
  ocultarMensajesLogin();
  const email = document.getElementById('loginEmail').value.trim();

  if(!email){
    mostrarErrorLogin('Escribí tu email arriba y después tocá "¿Olvidaste tu contraseña?".');
    return;
  }

  try {
    if(!supabaseConfigurado()){ mostrarErrorLogin('La aplicación todavía no está conectada a Supabase.'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    });
    if(error){
      mostrarErrorLogin(traducirErrorSupabase(error));
      return;
    }
    mostrarInfoLogin('Te enviamos un email con un link para cambiar tu contraseña. Revisá tu casilla (y la carpeta de spam).');
  } catch(e){
    mostrarErrorLogin('No se pudo conectar. Revisá tu conexión a internet.');
  }
}

async function cargarPerfilUsuario(){
  if(!usuarioActual || !supabaseConfigurado()) return false;
  try{
    const {data,error}=await sb.from('profiles').select('role,nombre_marca').eq('id',usuarioActual.id).maybeSingle();
    if(error) return false;
    usuarioEsAdmin = data && data.role === 'admin';
    if(data && data.nombre_marca) usuarioActual.nombreMarca=data.nombre_marca;
    setTimeout(mostrarBotonAdminSiCorresponde,200);
    return true;
  }catch(e){ return false; }
}

function onLoginExitoso(session){
  usuarioActual = { id: session.user.id, email: session.user.email, created_at: session.user.created_at };
  const nombreMarca = session.user.user_metadata && session.user.user_metadata.nombre_marca;
  usuarioActual.nombreMarca = nombreMarca || '';
  usuarioEsAdmin = false;
  cargarPerfilUsuario();
  colaSyncPendiente = cargarColaSync();
  actualizarIndicadorSync();

  document.getElementById('pantallaLogin').style.display = 'none';
  document.getElementById('appContainer').style.display = 'block';
  inicializarAppLuegoDeLogin();
  verificarSuscripcion();
  descargarDatosSupabase();

  if(!nombreMarca){
    setTimeout(()=>{ abrirModal('modalNombreMarca'); }, 300);
  } else {
    actualizarNombreMostrado();
    setTimeout(mostrarOnboardingSiCorresponde, 300);
  }
}

function actualizarNombreMostrado(){
  const el = document.getElementById('nombreMarcaMostrado');
  if(el) el.textContent = usuarioActual.nombreMarca || usuarioActual.email;
}

// ---------- CHEQUEO DE SUSCRIPCION ----------
const PLANES_SUSCRIPCION = {
  mensual: { nombre: 'Plan mensual', precio: 14999, periodo: 'mes' },
  anual: { nombre: 'Plan anual', precio: 159999, periodo: 'año' }
};

async function verificarSuscripcion(){
  try{
    if(!usuarioActual || !supabaseConfigurado()) return;
    const { data, error } = await sb.from('subscriptions').select('*').eq('user_id', usuarioActual.id).maybeSingle();
    if(error){
      // Si falla la consulta por una situación temporal, no bloqueamos el trabajo offline.
      return;
    }
    if(!data){
      // En el Supabase nuevo el trial se crea por trigger al registrar el usuario.
      // Si todavía no existe por una migración/estado transitorio, no bloqueamos la app.
      return;
    }

    if(data.status === 'trial') {
      const finTrial = data.trial_ends_at ? new Date(data.trial_ends_at) : new Date();
      if(new Date() < finTrial){
        mostrarEstadoMembresia(data);
        return;
      }
      const textoBloqueo = 'Tu período de prueba de 7 días terminó.\n\nElegí un plan para seguir usando Aguatero:';
      document.getElementById('textoSuscripcionBloqueada').textContent = textoBloqueo;
      document.getElementById('pantallaSuscripcionBloqueada').style.display = 'flex';
      mostrarEstadoMembresia({status:'trial_expired', trial_ends_at: finTrial.toISOString()});
      return;
    }

    const activa = data.status === 'active' &&
      (!data.current_period_end || new Date(data.current_period_end) > new Date());

    const diasRestantes = data.current_period_end
      ? Math.ceil((new Date(data.current_period_end) - new Date()) / 86400000)
      : null;

    if(!activa){
      // BLOQUEO TOTAL
      var textoBloqueo = data.current_period_end
        ? 'Tu suscripción venció el ' + isoAFechaLabel(data.current_period_end.slice(0,10)) + '.\n\n'
        : 'Todavía no tenés una suscripción activa.\n\n';
      textoBloqueo += 'Elegí un plan para seguir usando Aguatero:';

      document.getElementById('textoSuscripcionBloqueada').textContent = textoBloqueo;
      document.getElementById('pantallaSuscripcionBloqueada').style.display = 'flex';
      mostrarEstadoMembresia(data);
    } else {
      // Activa - mostrar estado en el menú
      mostrarEstadoMembresia(data);

      // Aviso si vence pronto (5 días o menos)
      if(diasRestantes !== null && diasRestantes <= 5 && diasRestantes > 0){
        mostrarToast('Tu suscripción vence en ' + diasRestantes + ' días. Se renueva sola con Mercado Pago.', 'error');
      }
    }
  }catch(e){
    // sin internet no se puede chequear: lo dejamos seguir trabajando offline con lo que ya tiene
  }
}

async function suscribirse(plan){
  if(!FUNCIONES_URL){
    mostrarToast('El sistema de pagos todavía no fue configurado para esta nueva aplicación.');
    return;
  }
  const btn = document.getElementById('btnSuscribir_' + plan);
  if(btn){ btn.disabled = true; btn.textContent = 'Abriendo Mercado Pago...'; }
  try{
    const session = sb && sb.auth ? await sb.auth.getSession() : null;
    const accessToken = session && session.data && session.data.session ? session.data.session.access_token : null;
    if(!accessToken) throw new Error('Sesión no disponible');
    const resp = await fetch(FUNCIONES_URL + '/createMercadoPagoSubscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + accessToken },
      body: JSON.stringify({ plan: plan })
    });
    const data = await resp.json();
    if(data && data.init_point){
      window.location.href = data.init_point;
    } else {
      mostrarToast('No se pudo iniciar el pago. Probá de nuevo en unos segundos.');
    }
  }catch(e){
    mostrarToast('No hay conexión con el servidor de pagos. Revisá tu internet e intentá de nuevo.');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = '💳 Suscribirme - $' + formatMoney(PLANES_SUSCRIPCION[plan].precio) + '/' + PLANES_SUSCRIPCION[plan].periodo; }
  }
}

function mostrarEstadoMembresia(data){
  var el = document.getElementById('estadoMembresiaMenu');
  if(!el) return;

  if(!data){
    // Trial
    el.innerHTML = '<div style="background:#fff3cd; border:1px solid #ffc107; color:#856404; padding:10px; border-radius:8px; font-size:0.82em;">' +
      '<strong>🟡 Período de prueba</strong><br>' +
      'Estás usando Aguatero sin suscripción activa.<br>' +
      'Mensual $' + formatMoney(PLANES_SUSCRIPCION.mensual.precio) + '/mes · Anual $' + formatMoney(PLANES_SUSCRIPCION.anual.precio) + '/año' +
    '</div>';
    return;
  }

  if(data.status === 'trial'){
    var trialEnd = data.trial_ends_at ? new Date(data.trial_ends_at) : new Date();
    var trialDays = Math.max(0, Math.ceil((trialEnd - new Date()) / 86400000));
    el.innerHTML = '<div style="background:#fff3cd; border:1px solid #ffc107; color:#856404; padding:10px; border-radius:8px; font-size:0.82em;"><strong>🟡 Período de prueba</strong><br>Te quedan ' + trialDays + ' días de prueba.<br>Mensual $' + formatMoney(PLANES_SUSCRIPCION.mensual.precio) + ' · Anual $' + formatMoney(PLANES_SUSCRIPCION.anual.precio) + '</div>';
    return;
  }
  if(data.status === 'trial_expired'){
    el.innerHTML = '<div style="background:#f8d7da; border:1px solid #c0392b; color:#721c24; padding:10px; border-radius:8px; font-size:0.82em;"><strong>🔴 Prueba finalizada</strong><br>Elegí un plan para seguir usando Aguatero.</div>';
    return;
  }

  var activa = data.status === 'active' && (!data.current_period_end || new Date(data.current_period_end) > new Date());
  var diasRestantes = data.current_period_end ? Math.ceil((new Date(data.current_period_end) - new Date()) / 86400000) : null;
  var infoPlan = PLANES_SUSCRIPCION[data.plan] || { nombre: data.plan || 'Suscripción', precio: null, periodo: '' };

  if(!activa){
    el.innerHTML = '<div style="background:#f8d7da; border:1px solid #c0392b; color:#721c24; padding:10px; border-radius:8px; font-size:0.82em;">' +
      '<strong>🔴 Suscripción vencida</strong><br>' +
      (data.current_period_end ? 'Venció: ' + isoAFechaLabel(data.current_period_end.slice(0,10)) + '<br>' : '') +
      'Elegí un plan para reactivar tu cuenta.' +
    '</div>';
  } else {
    var color = diasRestantes !== null && diasRestantes <= 5 ? '#fff3cd' : '#d4edda';
    var border = diasRestantes !== null && diasRestantes <= 5 ? '#ffc107' : '#2e8b57';
    var textColor = diasRestantes !== null && diasRestantes <= 5 ? '#856404' : '#155724';
    var icono = diasRestantes !== null && diasRestantes <= 5 ? '🟡' : '🟢';

    el.innerHTML = '<div style="background:' + color + '; border:1px solid ' + border + '; color:' + textColor + '; padding:10px; border-radius:8px; font-size:0.82em;">' +
      '<strong>' + icono + ' ' + infoPlan.nombre + ' activo</strong><br>' +
      (data.current_period_end ? 'Vence: ' + isoAFechaLabel(data.current_period_end.slice(0,10)) + (diasRestantes !== null ? ' (' + diasRestantes + ' días)' : '') + '<br>' : '') +
      (infoPlan.precio ? 'Precio: $' + formatMoney(infoPlan.precio) + '/' + infoPlan.periodo + '<br>' : '') +
      '<a href="https://www.mercadopago.com.ar/subscriptions" target="_blank" rel="noopener" style="color:' + textColor + '; text-decoration:underline;">Gestionar en Mercado Pago</a>' +
    '</div>';
  }
}

async function guardarNombreMarca(){
  const valor = document.getElementById('inputNombreMarca').value.trim();
  if(!valor){ mostrarToast('Escribí un nombre o el nombre de tu marca de agua.'); return; }
  try{
    await sb.auth.updateUser({ data: { nombre_marca: valor } });
    usuarioActual.nombreMarca = valor;
    actualizarNombreMostrado();
    cerrarModal('modalNombreMarca');
    setTimeout(mostrarOnboardingSiCorresponde, 300);
  }catch(e){
    mostrarToast('No se pudo guardar (revisá tu conexión). Lo podés cambiar después desde el menú.');
  }
}

async function cerrarSesion(){
  guardarEstado({forzarSync:true});
  await procesarColaSync();
  if(supabaseConfigurado()) await sb.auth.signOut();
  usuarioActual = null;
  usuarioEsAdmin = false;
  repartoActualId = null;
  colaSyncPendiente = [];
  document.getElementById('appContainer').style.display = 'none';
  document.getElementById('pantallaLogin').style.display = 'flex';
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
}

// Al abrir la app, nos fijamos si ya había una sesión iniciada (para no pedir
// el usuario y contraseña cada vez que se abre, sin necesitar internet siempre)
async function verificarSesionAlAbrir(){
  try{
    if(!supabaseConfigurado()) return;
    // Si la vez pasada desmarcó "Recordarme", no entramos solos: cerramos
    // esa sesión guardada y dejamos la pantalla de login a la vista.
    if(localStorage.getItem('aguatero_v2_no_recordar') === '1'){
      await sb.auth.signOut();
      return;
    }
    const { data } = await sb.auth.getSession();
    if(data.session){
      onLoginExitoso(data.session);
    }
  }catch(e){
    // sin internet o sin sesión: se queda en la pantalla de login
  }
}
verificarSesionAlAbrir();
// ---------- ESTADO ----------
const CLAVE_STORAGE_BASE = 'aguatero_v2_estado_v1';
function claveStorageActual(){
  return CLAVE_STORAGE_BASE + '_' + (usuarioActual ? usuarioActual.id : 'sin_sesion');
}
const DIAS = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo","sin dia"];

let clientes = [];
let contadorClientes = 0;
let clienteSeleccionado = null;
let clienteStockId = null;
let diaSeleccionado = diaDeHoy();
let searchTerm = '';
let searchType = 'nombre';
let modoTodosClientes = true; // Al abrir la app, mostrar todos los clientes

let ventaHoy = 0;
let cobradoHoy = 0;
let cobroDeudaHoy = 0;
let efectivoHoy = 0;
let transferenciaHoy = 0;
let entregadoHoy = 0;
let deudaGeneradaHoy = 0;
let envasesEntregadosHoy = 0;
let envasesRecibidosHoy = 0;
let envasesRecibidosB20Hoy = 0;
let envasesRecibidosB10Hoy = 0;
let b20VendidosHoy = 0;
let b10VendidosHoy = 0;
let dispVendidosHoy = 0;
let sodaVendidasHoy = 0;
let visitasHoy = new Set();
// Orden de atención del reparto actual: el último cliente atendido queda primero.
let ordenVisitasHoy = [];
let fechaContadores = todayISO();

// Stock de bidones que cargás en el camión antes de salir a repartir
let stockCamion = { b20: 0, b10: 0, disp: 0, soda: 0, vaciosB20: 0, vaciosB10: 0, vaciosSoda: 0 };

// Archivo de repartos cerrados, uno por fecha (para el reporte semanal)
let resumenesDiarios = {};

function diaDeHoy(){
  return DIAS[(new Date().getDay()+6)%7];
}

function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function diaDeFechaISO(fechaISO){
  if(!fechaISO) return diaDeHoy();
  const d = new Date(fechaISO + 'T00:00:00');
  return DIAS[(d.getDay()+6)%7];
}

function obtenerPreciosCliente(c, fechaISO){
  const dia = diaDeFechaISO(fechaISO || todayISO());
  const overrides = (c && c.preciosPorDia && c.preciosPorDia[dia]) || {};
  return {
    b20: overrides.b20 != null ? Number(overrides.b20) : Number(c.precio || 0),
    b10: overrides.b10 != null ? Number(overrides.b10) : Number(c.precio10 || 0),
    disp: overrides.disp != null ? Number(overrides.disp) : Number(c.precioDisp || 0),
    soda: overrides.soda != null ? Number(overrides.soda) : Number(c.precioSoda || 0)
  };
}

function asegurarPreciosPorDia(c){
  if(!c.preciosPorDia || typeof c.preciosPorDia !== 'object') c.preciosPorDia = {};
  return c.preciosPorDia;
}
var fechaInicioTrabajo = null;

function checkResetDia(){
  // El reparto solo se reinicia cuando el usuario confirma “Cerrar reparto”.
  if(!fechaInicioTrabajo) fechaInicioTrabajo=todayISO();
}

function isoAFechaLabel(iso){
  if(!iso || typeof iso !== 'string' || iso.indexOf('-') === -1) return '-';
  const [y,m,d] = iso.split('-');
  return d + '/' + m + '/' + y;
}

function actualizarFechaHoyLabel(){
  const dias = DIAS;
  const hoy = new Date();
  const nombreDia = dias[(hoy.getDay()+6)%7];
  document.getElementById('fechaHoyLabel').textContent = nombreDia + ' ' + isoAFechaLabel(todayISO());
}

function generarId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

// FIX: Evitar error de redondeo flotante en evaluación de deudas
function tieneDeuda(c){ return Math.round(c.saldo * 100) > 0; }

// FIX: Sanitizar HTML para prevenir XSS
function escapeHtml(text){
  if(!text) return '';
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------- FORMATO DE MONEDA (separador de miles estilo AR) ----------
function formatMoney(n){
  if(n === undefined || n === null || isNaN(n)) return '0';
  var neg = n < 0;
  n = Math.abs(Math.round(n));
  var str = n.toString();
  var formatted = '';
  var count = 0;
  for(var i = str.length - 1; i >= 0; i--){
    if(count > 0 && count % 3 === 0) formatted = '.' + formatted;
    formatted = str[i] + formatted;
    count++;
  }
  return (neg ? '-' : '') + formatted;
}
function $(amt){ return '$' + formatMoney(amt); }

// ---------- TOAST NOTIFICATIONS (reemplaza alert) ----------
function mostrarToast(mensaje, tipo){
  var cont = document.getElementById('toastContainer');
  if(!cont){
    cont = document.createElement('div');
    cont.id = 'toastContainer';
    cont.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:99999; pointer-events:none;';
    document.body.appendChild(cont);
  }
  var toast = document.createElement('div');
  var bgColor = tipo === 'error' ? '#c0392b' : tipo === 'success' ? '#27ae60' : '#2c3e50';
  toast.style.cssText = 'background:' + bgColor + '; color:white; padding:12px 20px; border-radius:8px; margin-top:8px; font-size:0.9em; box-shadow:0 4px 12px rgba(0,0,0,0.3); opacity:0; transition:opacity 0.3s; max-width:320px; text-align:center; pointer-events:auto;';
  toast.textContent = mensaje;
  cont.appendChild(toast);
  setTimeout(function(){ toast.style.opacity = '1'; }, 10);
  setTimeout(function(){
    toast.style.opacity = '0';
    setTimeout(function(){ if(toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }, Math.max(3000, Math.min(7000, 2500 + mensaje.length * 18)));
}

// ---------- DEUDA TOTAL (counter en el header) ----------
function calcularDeudaTotal(){
  var total = 0;
  clientes.forEach(function(c){ if(Math.round(c.saldo) > 0) total += c.saldo; });
  return total;
}

function actualizarDeudaTotal(){
  var el = document.getElementById('deudaTotalBadge');
  if(!el) return;
  var total = calcularDeudaTotal();
  if(total > 0){
    el.style.display = 'inline-block';
    el.textContent = 'Deuda afuera: $' + formatMoney(total);
  } else {
    el.style.display = 'none';
  }
}

function verificarResetDiario(){
  // No hacer reset automático por cambio de fecha.
  return false;
}

// ---------- GUARDADO EN EL CELULAR (localStorage) ----------
// Esto guarda los datos en el navegador de tu teléfono para que no se
// pierdan al cerrar la app. Funciona cuando abrís el archivo directamente
// en tu celular (Chrome, Spck, etc). En la vista previa del chat puede no
// conservarse porque el chat usa un entorno temporal.
// ---------- MEMORIA DOBLE: localStorage + IndexedDB de respaldo ----------
// Si el navegador/atajo borra localStorage, tratamos de recuperar de IndexedDB
const DB_NOMBRE = 'aguatero_v2_db';
const DB_ALMACEN = 'estado';
function claveDBUsuario(){ return 'estadoActual_' + (usuarioActual && usuarioActual.id ? usuarioActual.id : 'sin_sesion'); }
let promesaDB = null;

function abrirBaseRespaldo(){
  if(promesaDB) return promesaDB;
  promesaDB = new Promise((resolve)=>{
    if(!window.indexedDB){ resolve(null); return; }
    try{
      const req = indexedDB.open(DB_NOMBRE, 1);
      req.onupgradeneeded = function(e){
        const db = e.target.result;
        if(!db.objectStoreNames.contains(DB_ALMACEN)) db.createObjectStore(DB_ALMACEN);
      };
      req.onsuccess = function(e){ resolve(e.target.result); };
      req.onerror = function(){ resolve(null); };
    }catch(e){ resolve(null); }
  });
  return promesaDB;
}

function guardarEnBaseRespaldo(estado){
  abrirBaseRespaldo().then(db=>{
    if(!db) return;
    try{
      const tx = db.transaction(DB_ALMACEN, 'readwrite');
      tx.objectStore(DB_ALMACEN).put(estado, claveDBUsuario());
    }catch(e){ /* silencioso */ }
  });
}

function cargarDeBaseRespaldo(){
  return abrirBaseRespaldo().then(db=>{
    if(!db) return null;
    return new Promise(resolve=>{
      try{
        const tx = db.transaction(DB_ALMACEN, 'readonly');
        const req = tx.objectStore(DB_ALMACEN).get(claveDBUsuario());
        req.onsuccess = function(){ resolve(req.result || null); };
        req.onerror = function(){ resolve(null); };
      }catch(e){ resolve(null); }
    });
  });
}

function construirEstadoActual(){
  return {
    clientes,
    contadorClientes,
    clienteSeleccionado,
    diaSeleccionado,
    ventaHoy,cobradoHoy,cobroDeudaHoy,efectivoHoy,transferenciaHoy,entregadoHoy,
    deudaGeneradaHoy,envasesEntregadosHoy,envasesRecibidosHoy,envasesRecibidosB20Hoy,envasesRecibidosB10Hoy,
    b20VendidosHoy,b10VendidosHoy,dispVendidosHoy,sodaVendidasHoy,
    visitasHoy:Array.from(visitasHoy),
    ordenVisitasHoy:Array.from(ordenVisitasHoy),
    modoTodosClientes,
    fechaContadores,fechaInicioTrabajo,repartoActualId,stockCamion,resumenesDiarios,
    clientesFueraRutaHoy:Array.from(clientesFueraRutaHoy)
  };
}

function aplicarEstadoDesdeObjeto(estado){
  if(!estado) return;
  clientes=estado.clientes || [];
  contadorClientes=estado.contadorClientes || 0;
  clienteSeleccionado=estado.clienteSeleccionado || null;
  diaSeleccionado=estado.diaSeleccionado || diaDeHoy();
  ventaHoy=estado.ventaHoy || 0; cobradoHoy=estado.cobradoHoy || 0; cobroDeudaHoy=estado.cobroDeudaHoy || 0; efectivoHoy=estado.efectivoHoy || 0;
  transferenciaHoy=estado.transferenciaHoy || 0; entregadoHoy=estado.entregadoHoy || 0;
  deudaGeneradaHoy=estado.deudaGeneradaHoy || 0; envasesEntregadosHoy=estado.envasesEntregadosHoy || 0;
  envasesRecibidosHoy=estado.envasesRecibidosHoy || 0;
  envasesRecibidosB20Hoy=estado.envasesRecibidosB20Hoy || 0;
  envasesRecibidosB10Hoy=estado.envasesRecibidosB10Hoy || 0;
  b20VendidosHoy=estado.b20VendidosHoy || 0; b10VendidosHoy=estado.b10VendidosHoy || 0; dispVendidosHoy=estado.dispVendidosHoy || 0; sodaVendidasHoy=estado.sodaVendidasHoy || 0;
  visitasHoy=new Set(estado.visitasHoy || []);
  ordenVisitasHoy=Array.isArray(estado.ordenVisitasHoy) ? estado.ordenVisitasHoy.filter(id=>visitasHoy.has(id)) : Array.from(visitasHoy);
  modoTodosClientes=estado.modoTodosClientes !== undefined ? !!estado.modoTodosClientes : !repartoActualId;
  fechaContadores=estado.fechaContadores || todayISO();
  fechaInicioTrabajo=estado.fechaInicioTrabajo || fechaContadores;
  repartoActualId=estado.repartoActualId || null;
  stockCamion=Object.assign({b20:0,b10:0,disp:0,soda:0,vaciosB20:0,vaciosB10:0,vaciosSoda:0},estado.stockCamion||{});
  resumenesDiarios=estado.resumenesDiarios || {};
  clientesFueraRutaHoy=new Set(estado.clientesFueraRutaHoy || []);
}

// FIX: guardarEstado() se llama muy seguido (cada renderTodo()). El guardado
// local (localStorage + IndexedDB) se hace siempre, pero el sync con Supabase
// se limita a como máximo 1 vez cada 4 segundos para no generar tráfico/carga
// de más en repartos con muchas ventas seguidas. Igual se sigue sincronizando
// siempre después de cerrar el reparto o de acciones importantes.
let __ultimoSyncStockResumen = 0;
function guardarEstado(opciones){
  const estado = construirEstadoActual();
  try{
    localStorage.setItem(claveStorageActual(), JSON.stringify(estado));
  }catch(e){
    console.log('No se pudo guardar en localStorage:', e);
  }
  guardarEnBaseRespaldo(estado);
  // Sincronizar con Supabase (silencioso, solo si hay internet)
  if(usuarioActual){
    const ahora = Date.now();
    const forzar = opciones && opciones.forzarSync;
    if(forzar || (ahora - __ultimoSyncStockResumen) > 4000){
      __ultimoSyncStockResumen = ahora;
      syncStock(snapshotStock());
      if(repartoActualId){
        syncResumenDiario(fechaContadores || todayISO(), snapshotResumen(fechaContadores || todayISO()));
      }
    }
  }
}

function cargarEstado(){
  let cargadoOk = false;
  try{
    const guardado = localStorage.getItem(claveStorageActual());
    if(guardado){
      aplicarEstadoDesdeObjeto(JSON.parse(guardado));
      cargadoOk = true;
    }
  }catch(e){
    console.log('No se pudo cargar el estado guardado:', e);
  }
  verificarResetDiario();

  if(!cargadoOk){
    // La memoria principal vino vacía (se borró). Probamos recuperar
    // de la memoria de respaldo (IndexedDB), que es más difícil de borrar.
    cargarDeBaseRespaldo().then(estado=>{
      if(estado){
        aplicarEstadoDesdeObjeto(estado);
        verificarResetDiario();
        guardarEstado();
        renderTodo();
        const fechaRespaldo = estado.ultimaModificacion
          ? new Date(estado.ultimaModificacion).toLocaleString('es-AR')
          : 'una fecha anterior';
        mostrarToast(`⚠️ Se recuperaron datos de una copia de seguridad automática (del ${fechaRespaldo}), porque la memoria principal del celular se vació.\n\nRevisá que esté todo correcto — si ves algo raro o viejo (como clientes que ya habías borrado), podés eliminarlo de nuevo tranquilo.`);
      }
    });
  }
}

// ---------- NAVEGACION DE TABS ----------
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    // Al cambiar de tab, limpiar búsqueda
    searchTerm = '';
    document.getElementById('inputBusqueda').value = '';
    document.getElementById('panelBusqueda').classList.remove('activo');
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-'+btn.dataset.tab).classList.add('active');
    cerrarMenus();
    renderTodo();
  });
});

// ---------- MENUS Y PANELES DESPLEGABLES ----------
function cerrarMenus(){
  document.getElementById('menuDropdown').classList.remove('activo');
  document.getElementById('diaDropdown').classList.remove('activo');
}

// Cerrar dropdowns al tocar fuera de ellos
document.addEventListener('click', function(e){
  const diaDropdown = document.getElementById('diaDropdown');
  const menuDropdown = document.getElementById('menuDropdown');
  const panelBusqueda = document.getElementById('panelBusqueda');
  
  // Si el dropdown de día está abierto y el click no fue en el dropdown ni en su botón
  if(diaDropdown.classList.contains('activo')){
    if(!diaDropdown.contains(e.target) && !e.target.closest("[onclick*='diaDropdown']")){
      diaDropdown.classList.remove('activo');
    }
  }
  // Lo mismo para el menú principal
  if(menuDropdown.classList.contains('activo')){
    if(!menuDropdown.contains(e.target) && !e.target.closest("[onclick*='menuDropdown']") && !e.target.closest("[onclick*='toggleMenu']")){
      menuDropdown.classList.remove('activo');
    }
  }
  // Y para el panel de búsqueda
  if(panelBusqueda && panelBusqueda.classList.contains('activo')){
    if(!panelBusqueda.contains(e.target) && !e.target.closest("[onclick*='panelBusqueda']")){
      panelBusqueda.classList.remove('activo');
    }
  }
});
function toggleMenu(){
  document.getElementById('diaDropdown').classList.remove('activo');
  document.getElementById('menuDropdown').classList.toggle('activo');
}
function togglePanel(id){
  document.getElementById('menuDropdown').classList.remove('activo');
  const otro = id === 'diaDropdown' ? null : 'diaDropdown';
  if(id === 'panelBusqueda'){
    document.getElementById('diaDropdown').classList.remove('activo');
    document.getElementById('panelBusqueda').classList.toggle('activo');
  } else {
    document.getElementById('panelBusqueda').classList.remove('activo');
    document.getElementById(id).classList.toggle('activo');
  }
}
// ---------- RECORDATORIO DE CLIENTES INACTIVOS ----------
function mostrarClientesInactivos(){
  cerrarMenus();
  var diasSinVisita = 14; // 2 semanas sin visita
  var ahora = new Date();
  var inactivos = [];

  clientes.forEach(function(c){
    if(c.historial.length === 0){
      inactivos.push({ cliente: c, dias: -1, ultimaVisita: null });
      return;
    }
    var ultimaFecha = null;
    c.historial.forEach(function(h){
      if(h.tipo === 'compra' || h.tipo === 'no_compra'){
        if(!ultimaFecha || (h.fechaISO || '') > ultimaFecha) ultimaFecha = h.fechaISO;
      }
    });
    if(!ultimaFecha){
      inactivos.push({ cliente: c, dias: -1, ultimaVisita: null });
      return;
    }
    var dias = Math.floor((ahora - new Date(ultimaFecha + 'T00:00:00')) / 86400000);
    if(dias >= diasSinVisita){
      inactivos.push({ cliente: c, dias: dias, ultimaVisita: ultimaFecha });
    }
  });

  inactivos.sort(function(a, b){ return b.dias - a.dias; });

  var cont = document.getElementById('listaClientesInactivos');
  if(!cont) return;

  if(inactivos.length === 0){
    cont.innerHTML = '<div class="empty-msg">\u2705 Todos tus clientes fueron visitados en las \u00faltimas 2 semanas</div>';
  } else {
    cont.innerHTML = '<div style="padding:8px 0; font-size:0.85em; color:#666;">' + inactivos.length + ' clientes sin visita en m\u00e1s de ' + diasSinVisita + ' d\u00edas:</div>' +
      inactivos.map(function(item){
        var c = item.cliente;
        var diasTxt = item.dias === -1 ? 'Nunca visitado' : 'Hace ' + item.dias + ' d\u00edas';
        var tel = (c.telefono || '').replace(/[^0-9]/g, '');
        var botonTel = tel
          ? '<a class="btn chico" style="text-decoration:none; text-align:center;" href="https://wa.me/' + tel + '">\ud83d\udcac WhatsApp</a>'
          : '';
        var botonMaps = c.direccion
          ? '<a class="btn chico outline" style="text-decoration:none; text-align:center;" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(c.direccion) + '" target="_blank">\ud83d\udccd C\u00f3mo llegar</a>'
          : '';
        // CORRECCIÓN: la función escapeHtml ya se aplica en c.nombre y c.nota
        return '<div class="card tiene-deuda">' +
          '<div onclick="abrirDetalle(\'' + c.id + '\')" style="cursor:pointer;">' +
          '<h3>' + c.codigo + ' - ' + escapeHtml(c.nombre) + '</h3>' +
          '<div class="row"><span>\u00daltima visita:</span><span style="color:#c0392b; font-weight:600;">' + diasTxt + '</span></div>' +
          '<div class="row"><span>Deuda:</span><span class="deuda">' + textoSaldo(c) + '</span></div>' +
          '<div class="row"><span>Envases que debe:</span><span>' + c.envasesPendientes + '</span></div>' +
          (c.nota ? '<div style="font-size:0.78em; color:#e08a3e; padding:2px 0;">\ud83d\udcdd ' + escapeHtml(c.nota) + '</div>' : '') +
          '</div>' +
          '<div class="btn-row">' + botonTel + botonMaps + '</div>' +
          '</div>';
      }).join('');
  }

  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
  document.getElementById('view-clientesInactivos').classList.add('active');
}

// ---------- COMPARTIR RESUMEN POR WHATSAPP ----------
function textoSaldo(c){
  const s = Math.round(Number(c && c.saldo || 0));
  const favor = Math.round(Number(c && c.saldoAFavor || 0));
  if(s > 0 && favor > 0) return 'Debe: $' + formatMoney(s) + ' · A favor: $' + formatMoney(favor);
  if(s > 0) return 'Debe: $' + formatMoney(s);
  if(favor > 0) return 'A favor: +$' + formatMoney(favor);
  return 'Al día: $0';
}

function construirMensajeCierreDia(){
  const marca = (usuarioActual && usuarioActual.nombreMarca) ? usuarioActual.nombreMarca : 'Aguatero';
  const n = v => Number(v || 0);
  const vaciosB20 = n(stockCamion && stockCamion.vaciosB20);
  const vaciosB10 = n(stockCamion && stockCamion.vaciosB10);
  const totalVacios = vaciosB20 + vaciosB10;
  return [
    '📊 CIERRE DEL DÍA - ' + marca,
    'Fecha: ' + diaDeHoy() + ' ' + isoAFechaLabel(todayISO()),
    '',
    '💰 VENTAS Y COBROS',
    'Venta total: $' + formatMoney(ventaHoy),
    'Cobrado total: $' + formatMoney(cobradoHoy),
    '  • Deuda anterior cobrada: $' + formatMoney(cobroDeudaHoy),
    '  • Efectivo: $' + formatMoney(efectivoHoy),
    '  • Transferencia: $' + formatMoney(transferenciaHoy),
    'Deuda generada: $' + formatMoney(deudaGeneradaHoy),
    '',
    '📦 PRODUCTOS VENDIDOS',
    '20 L: ' + n(b20VendidosHoy),
    '10–12 L: ' + n(b10VendidosHoy),
    'Dispenser: ' + n(dispVendidosHoy),
    'Soda: ' + n(sodaVendidasHoy),
    '',
    '♻️ ENVASES VACÍOS RECIBIDOS',
    '20 L: ' + vaciosB20,
    '10–12 L: ' + vaciosB10,
    'Total vacíos: ' + totalVacios,
    '',
    '👥 Clientes visitados: ' + visitasHoy.size,
    '',
    '🚚 SOBRANTE EN CAMIÓN',
    '20 L: ' + n(stockCamion && stockCamion.b20),
    '10–12 L: ' + n(stockCamion && stockCamion.b10),
    'Dispenser: ' + n(stockCamion && stockCamion.disp),
    'Soda: ' + n(stockCamion && stockCamion.soda)
  ].join('\n');
}

function abrirWhatsAppConTexto(texto){
  const url = 'https://wa.me/?text=' + encodeURIComponent(texto);
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.display='none';
  document.body.appendChild(a); a.click();
  setTimeout(()=>a.remove(),1000);
}

function compartirCierreRepartoWhatsApp(){
  abrirWhatsAppConTexto(construirMensajeCierreDia());
}

function compartirResumenDia(){
  abrirWhatsAppConTexto(construirMensajeCierreDia());
}

function mostrarEstadisticas(){
  cerrarMenus();
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-estadisticas').classList.add('active');
  renderEstadisticas();
}
function volverDeEstadisticas(){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-porVisitar').classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="porVisitar"]').classList.add('active');
}

// Selector de dia (icono calendario)
function renderSelectorDiaVista(){
  const cont = document.getElementById('selectorDiaVista');
  cont.innerHTML = '';
  DIAS.forEach(dia=>{
    const chip = document.createElement('button');
    chip.className = 'dia-chip' + (dia===diaConsulta ? ' activo':'');
    chip.textContent = dia;
    chip.onclick = ()=>{
      abrirConsultaDia(dia);
      cerrarMenus();
    };
    cont.appendChild(chip);
  });
}

// Buscador
function actualizarPlaceholderBusqueda(){
  const input = document.getElementById('inputBusqueda');
  if(!input) return;
  const textos = {nombre:'Buscar por nombre del cliente...', telefono:'Buscar por teléfono...', domicilio:'Buscar por dirección...'};
  input.placeholder = textos[searchType] || textos.nombre;
}

function seleccionarModoContacto(modo){
  localStorage.setItem('modoContactoPref', modo);
  cerrarModal('modalModoContacto');
  importarDesdeContactos();
}

function preguntaRapidaHelp(texto){
  const input=document.getElementById('helpInput');
  if(input){ input.value=texto; enviarPreguntaHelp(); }
}

function contactarAdministracion(){
  const nombre=(usuarioActual && (usuarioActual.nombreMarca || usuarioActual.nombre)) || 'un repartidor';
  const mensaje=`Hola, soy ${nombre}, repartidor de Aguatero. Necesito ayuda con la aplicación. ¿Podés ayudarme?`;
  if(!ADMIN_WHATSAPP){ mostrarToast('El WhatsApp de soporte todavía no fue configurado para esta instalación.'); return; }
  window.location.href=`https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(mensaje)}`;
}

function abrirModalMensajeTransferencia(){
  const input=document.getElementById('inputMensajeTransferencia');
  if(input) input.value=localStorage.getItem('aguatero_v2_mensajeTransferenciaPendiente') ||
    'Hola [NOMBRE] 👋 Te recuerdo que quedó pendiente la transferencia de $[MONTO] correspondiente al reparto del [FECHA]. Cuando puedas, por favor realizala. ¡Gracias!';
  abrirModal('modalMensajeTransferencia');
}

function guardarMensajeTransferencia(){
  const input=document.getElementById('inputMensajeTransferencia');
  const texto=input ? input.value.trim() : '';
  if(!texto){ mostrarToast('Escribí un mensaje antes de guardar','error'); return; }
  localStorage.setItem('aguatero_v2_mensajeTransferenciaPendiente',texto);
  cerrarModal('modalMensajeTransferencia');
  mostrarToast('Mensaje de transferencia guardado','success');
}

function renderFiltroTabs(){
  const cont=document.getElementById('filtroTabs');
  if(!cont) return;
  cont.innerHTML='';
  [['nombre','Nombre'],['telefono','Teléfono'],['domicilio','Dirección']].forEach(([valor,label])=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='filtro-tab'+(searchType===valor?' activo':'');
    btn.textContent=label;
    btn.onclick=(e)=>{e.preventDefault();e.stopPropagation();searchType=valor;renderFiltroTabs();actualizarPlaceholderBusqueda();const input=document.getElementById('inputBusqueda');if(input){input.focus();input.select();}};
    cont.appendChild(btn);
  });
  actualizarPlaceholderBusqueda();
}
// ---------- ONBOARDING PRIMERA VEZ ----------
const PASOS_ONBOARDING = [
  { titulo: '📇 1. Cargá tus clientes', texto: 'Tocá el botón + para agregar un cliente, o "Importar clientes desde Contactos" en el menú para traerlos de tu agenda.' },
  { titulo: '🚚 2. Cargá el stock del camión', texto: 'Antes de salir a repartir, andá a ☰ → "Stock del camión" y anotá cuántos bidones sacaste (20L, 10-12L, dispensers).' },
  { titulo: '📦 3. Registrá cada venta', texto: 'En "Por visitar", tocá "Stock" en la tarjeta del cliente para anotar lo que te compró y cómo te pagó.' },
  { titulo: '🔒 4. Cerrá el reparto al final del día', texto: 'En ☰ → "Resumen del día" tocá "Cerrar reparto del día" para guardar el total y dejar todo listo para mañana.' }
];
let pasoOnboardingActual = 0;

function mostrarOnboardingSiCorresponde(){
  if(localStorage.getItem('aguatero_v2_onboarding_visto') === '1') return;
  pasoOnboardingActual = 0;
  renderPasoOnboarding();
  abrirModal('modalOnboarding');
}

function renderPasoOnboarding(){
  const paso = PASOS_ONBOARDING[pasoOnboardingActual];
  document.getElementById('onboardingContenido').innerHTML =
    `<h2>${paso.titulo}</h2><p style="font-size:0.9em; color:#666;">${paso.texto}</p>` +
    `<p style="font-size:0.75em; color:#999; text-align:center;">${pasoOnboardingActual+1} / ${PASOS_ONBOARDING.length}</p>`;
  document.getElementById('btnOnboardingSiguiente').textContent =
    (pasoOnboardingActual === PASOS_ONBOARDING.length - 1) ? 'Entendido' : 'Siguiente';
}

function siguienteOnboarding(){
  pasoOnboardingActual++;
  if(pasoOnboardingActual >= PASOS_ONBOARDING.length){
    cerrarOnboarding();
    return;
  }
  renderPasoOnboarding();
}

function cerrarOnboarding(){
  localStorage.setItem('aguatero_v2_onboarding_visto', '1');
  cerrarModal('modalOnboarding');
}

// ---------- INDICADOR SIN CONEXION ----------
function actualizarIndicadorConexion(){
  const el = document.getElementById('indicadorSinConexion');
  if(!el) return;
  el.style.display = navigator.onLine ? 'none' : 'block';
}
window.addEventListener('online', actualizarIndicadorConexion);
window.addEventListener('offline', actualizarIndicadorConexion);
actualizarIndicadorConexion();

// ---------- MODO OSCURO ----------
function alternarModoOscuro(){
  const activo = document.body.classList.toggle('oscuro');
  localStorage.setItem('aguatero_v2_modo_oscuro', activo ? '1' : '0');
  actualizarTextoModoOscuro();
  cerrarMenus();
}

function actualizarTextoModoOscuro(){
  const boton = document.getElementById('btnModoOscuro');
  if(!boton) return;
  boton.textContent = document.body.classList.contains('oscuro') ? '☀️ Modo claro' : '🌙 Modo oscuro';
}

if(localStorage.getItem('aguatero_v2_modo_oscuro') === '1'){
  document.body.classList.add('oscuro');
}
actualizarTextoModoOscuro();

function onBuscar(){
  const input=document.getElementById('inputBusqueda');
  searchTerm=input ? input.value.trim() : '';
  const panel=document.getElementById('panelBusqueda');
  if(panel && searchTerm) panel.classList.add('activo');
  renderTodo();
}

// ---------- BUSQUEDA POR VOZ ----------
function buscarPorVoz(){
  const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!Reconocimiento){
    mostrarToast('Tu navegador no permite la búsqueda por voz. Probá escribiendo en el buscador, o usá Chrome actualizado.');
    return;
  }
  const boton = document.getElementById('btnBusquedaVoz');
  const reconocimiento = new Reconocimiento();
  reconocimiento.lang = 'es-AR';
  reconocimiento.interimResults = false;
  reconocimiento.maxAlternatives = 1;

  boton.textContent = '🔴';
  boton.disabled = true;

  reconocimiento.onresult = function(evento){
    const texto = evento.results[0][0].transcript;
    document.getElementById('inputBusqueda').value = texto;
    onBuscar();
  };
  reconocimiento.onerror = function(){
    mostrarToast('No se pudo escuchar bien. Probá de nuevo, o escribí en el buscador.');
  };
  reconocimiento.onend = function(){
    boton.textContent = '🎤';
    boton.disabled = false;
  };

  try{
    reconocimiento.start();
  }catch(e){
    boton.textContent = '🎤';
    boton.disabled = false;
  }
}
function pasaFiltro(c){
  if(!searchTerm) return true;
  const term=searchTerm.toLowerCase();
  if(searchType==='nombre') return (c.nombre||'').toLowerCase().includes(term);
  if(searchType==='telefono'){
    const telefono=String(c.telefono||'').toLowerCase();
    const limpioTelefono=telefono.replace(/\D/g,'');
    const limpioTermino=term.replace(/\D/g,'');
    return telefono.includes(term) || (limpioTermino && limpioTelefono.includes(limpioTermino));
  }
  if(searchType==='domicilio') return (c.direccion||'').toLowerCase().includes(term);
  return true;
}

// ---------- IMPORTAR CLIENTES DESDE CONTACTOS (agenda del celular) ----------
async function importarDesdeContactos(){
  cerrarMenus();

  if(!('contacts' in navigator && 'ContactsManager' in window)){
    mostrarToast('Tu celular o tu navegador no permite esta función todavía.\n\nSolo anda en Chrome para Android (versión 80 o más nueva). Si estás en otro navegador o en iPhone, tenés que cargar los clientes a mano con el botón +.');
    return;
  }

  // Elegir el formato mediante un modal propio, sin prompt/alert del navegador.
  let modoContacto = localStorage.getItem('modoContactoPref') || '';
  if(!modoContacto){
    abrirModal('modalModoContacto');
    return;
  }

  try{
    const propiedades = ['name','tel'];
    const contactos = await navigator.contacts.select(propiedades, {multiple:true});
    if(!contactos || contactos.length === 0) return;

    let importados = 0;
    contactos.forEach(ct=>{
      const nombreCompleto = (ct.name && ct.name[0]) ? ct.name[0].trim() : '';
      if(!nombreCompleto) return;
      const telefono = (ct.tel && ct.tel[0]) ? ct.tel[0].replace(/[^0-9]/g,'') : '';

      let nombre = '';
      let direccion = '';

      if(modoContacto === '1'){
        // Guarda por dirección → el contacto va a direccion, nombre queda genérico
        direccion = nombreCompleto;
        nombre = 'Cliente';
      } else if(modoContacto === '2'){
        // Guarda por nombre → todo al nombre
        nombre = nombreCompleto;
        direccion = '';
      } else {
        // Mixto: intentar separar
        nombre = nombreCompleto;
        direccion = '';
        const separadores = [' - ', ' \u2013 ', ', '];
        for(const sep of separadores){
          if(nombreCompleto.includes(sep)){
            const partes = nombreCompleto.split(sep);
            nombre = partes[0].trim();
            direccion = partes.slice(1).join(sep).trim();
            break;
          }
        }
      }

      contadorClientes++;
      const cliente = {
        id: generarId(),
        codigo: contadorClientes,
        nombre,
        telefono,
        direccion,
        precio: 5000,
        dias: [],
        saldo: 0,
        envasesPendientes: 0,
        historial: [],
        ordenPorDia: {}
      };
      clientes.push(cliente);
      importados++;
    });

    guardarEstado();
    renderTodo();

    let msg = 'Se importaron ' + importados + ' contactos ✅\n\n';
    if(modoContacto === '1'){
      msg += 'Pusimos el nombre del contacto como DIRECCIÓN.\n';
      msg += 'Buscalos en "Fuera de reparto" y ponele el nombre real tocando ✏️ Editar datos.';
    } else if(modoContacto === '2'){
      msg += 'Pusimos el contacto como NOMBRE del cliente.\n';
      msg += 'Buscalos en "Fuera de reparto" y completá la dirección tocando ✏️ Editar datos.';
    } else {
      msg += 'Si algún contacto no se separó bien, podés editarlo tocando ✏️ Editar datos.';
    }
    mostrarToast(msg);
  }catch(e){
    // el usuario canceló el selector, no hacemos nada
  }
}
// ---------- MODAL NUEVO CLIENTE ----------
function abrirModalCargarReparto(){
  cerrarMenus();
  const cont = document.getElementById('selectorDiaActivo');
  cont.innerHTML = '';
  DIAS.forEach(dia=>{
    const chip = document.createElement('button');
    chip.className = 'dia-chip' + (dia===diaSeleccionado ? ' activo':'');
    chip.textContent = dia;
    chip.onclick = ()=>{
      diaSeleccionado = dia;
      modoTodosClientes = false;
      verificarResetDiario();
      cerrarModal('modalCargarReparto');
      renderTodo();
    };
    cont.appendChild(chip);
  });
  abrirModal('modalCargarReparto');
}

function volverATodosLosClientes(){
  modoTodosClientes = true;
  searchTerm = '';
  if(document.getElementById('inputBusqueda')) document.getElementById('inputBusqueda').value = '';
  renderTodo();
}

// ---------- CONSULTAR CLIENTES DE OTRO DIA ----------
let diaConsulta = null;

function abrirConsultaDia(dia){
  diaConsulta = dia;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-consultaDia').classList.add('active');
  document.getElementById('tituloConsultaDia').textContent = 'Clientes de ' + dia;
  renderConsultaDia();
}

function renderConsultaDia(){
  if(!diaConsulta){
    document.getElementById('listaConsultaDia').innerHTML = '';
    return;
  }
  const cont = document.getElementById('listaConsultaDia');
  const filtrados = clientes.filter(c=>c.dias.includes(diaConsulta) && pasaFiltro(c));
  if(filtrados.length === 0){
    cont.innerHTML = '<div class="empty-msg">Sin clientes para ese día</div>';
    return;
  }
  // CORRECCIÓN XSS: escapeHtml en nombre
  cont.innerHTML = filtrados.map(c=>{
    const yaAgregado = clientesFueraRutaHoy.has(c.id);
    const puedeAgregar = diaConsulta !== diaSeleccionado;
    return `
    <div class="card">
      <div onclick="abrirDetalle('${c.id}')">
        <h3>${c.codigo} - ${escapeHtml(c.nombre)}</h3>
        <div class="row"><span>${escapeHtml(c.direccion || '')}</span></div>
        <div class="row"><span>Saldo:</span><span class="${tieneDeuda(c)?'deuda':'saldo-ok'}">${textoSaldo(c)}</span></div>
        <div class="row"><span>Último movimiento:</span><span>${c.historial.length > 0 ? c.historial[c.historial.length-1].fechaISO : 'Nunca'}</span></div>
      </div>
      ${(puedeAgregar && !yaAgregado) ? `<button class="btn chico naranja" style="margin-top:6px;" onclick="agregarAFueraDeReparto('${c.id}')">🚚➕ Agregar a fuera de reparto de hoy</button>` : ''}
      ${(puedeAgregar && yaAgregado) ? `<div class="row" style="color:var(--verde-pago); font-weight:bold; margin-top:6px;">✅ Ya está en fuera de reparto de hoy</div>` : ''}
    </div>
  `;
  }).join('');
}

function abrirModalNuevoCliente(){
  document.getElementById('tituloModalCliente').textContent = 'Nuevo cliente';
  document.getElementById('inputNombre').value = '';
  document.getElementById('inputTelefono').value = '';
  document.getElementById('inputDireccion').value = '';
  document.getElementById('inputPrecio').value = 5000;
  document.getElementById('inputPrecio10').value = 3000;
  document.getElementById('inputPrecioDisp').value = 8000;
  document.getElementById('inputPrecioSoda').value = 1500;
  renderDiasSelector('diasClienteSelector', []);
  renderSelectDespuesDe();
  clienteSeleccionado = null;
  cerrarMenus();
  abrirModal('modalCliente');
}
// FIX: listener seguro - #btnAgregar ya no existe en el HTML actual (solo #btnAgregarTop).
// Antes esto tiraba un error apenas cargaba app.js y cortaba TODO el código que
// venía después (login, render, service worker, etc quedaban sin definir).
var __btnAgregarViejo = document.getElementById('btnAgregar');
if(__btnAgregarViejo) __btnAgregarViejo.addEventListener('click', abrirModalNuevoCliente);
var __btnAgregarTop = document.getElementById('btnAgregarTop');
if(__btnAgregarTop) __btnAgregarTop.addEventListener('click', abrirModalNuevoCliente);

// FIX: Cerrar modal al tocar afuera
document.addEventListener('click', function(e){
  if(e.target.classList && e.target.classList.contains('modal-bg')){
    cerrarModal(e.target.id);
  }
});

function abrirModal(id){ document.getElementById(id).classList.add('active'); }
function cerrarModal(id){ document.getElementById(id).classList.remove('active'); }

function renderDiasSelector(contenedorId, diasActivos){
  const cont = document.getElementById(contenedorId);
  cont.innerHTML = '';
  DIAS.forEach(dia=>{
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'dia-chip' + (diasActivos.includes(dia) ? ' activo' : '');
    chip.textContent = dia;
    chip.onclick = ()=>{
      chip.classList.toggle('activo');
      renderSelectDespuesDe();
    };
    cont.appendChild(chip);
  });
  renderSelectDespuesDe();
}

function diasSeleccionadosDe(contenedorId){
  return Array.from(document.querySelectorAll('#'+contenedorId+' .dia-chip.activo')).map(c=>c.textContent);
}
function normalizarTextoRuta(texto){
  return (texto || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

function extraerDireccionRuta(direccion){
  const texto = (direccion || '').trim();
  const m = texto.match(/^(.+?)(?:\s+|,\s*)(\d+)\s*$/);
  if(!m) return {calle: normalizarTextoRuta(texto), numero:null};
  return {calle: normalizarTextoRuta(m[1]), numero:parseInt(m[2],10)};
}

function ordenarOpcionesRuta(lista, direccionNueva, termino, dia){
  const nueva = extraerDireccionRuta(direccionNueva);
  const q = normalizarTextoRuta(termino);
  let arr = lista.filter(c=>{
    if(!q) return true;
    const dir = normalizarTextoRuta(c.direccion);
    const nom = normalizarTextoRuta(c.nombre);
    const calle = extraerDireccionRuta(c.direccion).calle;
    return dir.includes(q) || calle.includes(q) || nom.includes(q) || String(c.codigo).includes(q);
  });
  arr.sort((a,b)=>{
    const da=extraerDireccionRuta(a.direccion), db=extraerDireccionRuta(b.direccion);
    if(q){
      const aC=da.calle.includes(q)?0:1, bC=db.calle.includes(q)?0:1;
      if(aC!==bC) return aC-bC;
    }
    if(nueva.calle){
      const aM=da.calle===nueva.calle?0:1, bM=db.calle===nueva.calle?0:1;
      if(aM!==bM) return aM-bM;
      if(nueva.numero!=null && da.numero!=null && db.numero!=null && aM===0){
        const difA=Math.abs(da.numero-nueva.numero), difB=Math.abs(db.numero-nueva.numero);
        if(difA!==difB) return difA-difB;
      }
    }
    return (a.ordenPorDia[dia]||0)-(b.ordenPorDia[dia]||0);
  });
  return arr;
}

function renderSelectDespuesDe(){
  const cont = document.getElementById('contenedorOrdenRuta');
  if(!cont) return;
  const dias = diasSeleccionadosDe('diasClienteSelector');
  if(!dias.length){
    cont.innerHTML='<div class="orden-ruta-vacio">Elegí al menos un día para acomodar al cliente en la ruta.</div>';
    return;
  }
  const direccionNueva = (document.getElementById('inputDireccion')?.value || '').trim();
  const valoresPrevios = {};
  cont.querySelectorAll('[data-orden-dia]').forEach(box=>{
    const dia=box.dataset.ordenDia;
    const sel=box.querySelector('select');
    if(sel) valoresPrevios[dia]=sel.value;
  });
  cont.innerHTML = dias.map(dia=>{
    const candidatos=clientes.filter(c=>c.dias.includes(dia) && c.id!==clienteSeleccionado);
    const nueva=extraerDireccionRuta(direccionNueva);
    const ordenActual=candidatos.slice().sort((a,b)=>(a.ordenPorDia[dia]||0)-(b.ordenPorDia[dia]||0));
    let sugerido='';
    if(direccionNueva){
      const ordenados=ordenarOpcionesRuta(ordenActual,direccionNueva,'',dia);
      if(ordenados.length && nueva.numero!=null && nueva.calle && extraerDireccionRuta(ordenados[0].direccion).calle===nueva.calle) sugerido=ordenados[0].id;
    }
    const valor=valoresPrevios[dia] || sugerido || '';
    const options=['<option value="">Al final del recorrido</option>'].concat(ordenActual.map(c=>`<option value="${c.id}" ${c.id===valor?'selected':''}>📍 ${escapeHtml(c.direccion || 'Sin dirección')} — ${escapeHtml(c.nombre || 'Cliente')}</option>`)).join('');
    return `<div class="orden-ruta-dia" data-orden-dia="${dia}">
      <label>Ruta de <strong>${dia}</strong></label>
      <input type="search" class="input-busqueda-ruta" placeholder="🔎 Buscar calle o dirección (ej. Mitre)" data-dia-busqueda="${dia}">
      <select id="inputDespuesDe_${dia}" data-dia-select="${dia}">${options}</select>
      <div class="orden-ruta-hint">${sugerido ? '💡 Sugerencia: dirección más cercana a '+escapeHtml(direccionNueva)+'.' : 'Las direcciones se muestran primero; buscá una calle para encontrar rápidamente los clientes cercanos.'}</div>
    </div>`;
  }).join('');
  cont.querySelectorAll('.input-busqueda-ruta').forEach(inp=>{
    inp.addEventListener('input',()=>{
      const dia=inp.dataset.diaBusqueda;
      const box=cont.querySelector(`[data-orden-dia="${dia}"]`);
      const sel=box.querySelector('select');
      const termino=inp.value;
      const candidatos=clientes.filter(c=>c.dias.includes(dia) && c.id!==clienteSeleccionado);
      const ordenados=ordenarOpcionesRuta(candidatos,direccionNueva,termino,dia);
      const actual=sel.value;
      sel.innerHTML='<option value="">Al final del recorrido</option>'+ordenados.map(c=>`<option value="${c.id}" ${c.id===actual?'selected':''}>📍 ${escapeHtml(c.direccion || 'Sin dirección')} — ${escapeHtml(c.nombre || 'Cliente')}</option>`).join('');
      const hint=box.querySelector('.orden-ruta-hint');
      hint.textContent=termino ? `Encontrados ${ordenados.length} cliente(s) relacionados con “${termino}”. Las coincidencias de la calle quedan primero.` : 'Las direcciones se muestran primero; buscá una calle para encontrar rápidamente los clientes cercanos.';
    });
  });
}

const __inputDireccionRuta = document.getElementById('inputDireccion');
if(__inputDireccionRuta) __inputDireccionRuta.addEventListener('input', ()=>renderSelectDespuesDe());

// ---------- CRUD CLIENTES ----------
// ---------- CORREGIR PRECIOS POR DÍA ----------
let __corregirPrecioPaso = 1;
let __corregirPrecioDias = [];

function abrirAumentoMasivo(){
  cerrarMenus();
  __corregirPrecioPaso = 1;
  __corregirPrecioDias = [];
  document.getElementById('modalCorregirPrecio').classList.add('active');
  prepararCorregirPrecio();
}

function prepararCorregirPrecio(){
  const diasCont = document.getElementById('corregirPrecioDias');
  diasCont.innerHTML = '';
  const todos = document.createElement('button');
  todos.type='button'; todos.className='dia-chip'; todos.textContent='Todos';
  todos.onclick=()=>{
    __corregirPrecioDias = DIAS.filter(d=>d!=='sin dia').slice();
    diasCont.querySelectorAll('.dia-chip').forEach(x=>x.classList.remove('activo'));
    todos.classList.add('activo');
    diasCont.querySelectorAll('.dia-chip[data-dia]').forEach(x=>x.classList.add('activo'));
  };
  diasCont.appendChild(todos);
  DIAS.filter(d=>d!=='sin dia').forEach(dia=>{
    const b=document.createElement('button'); b.type='button'; b.className='dia-chip'; b.dataset.dia=dia; b.textContent=dia.slice(0,3);
    b.title=dia;
    b.onclick=()=>{
      // Si estaba seleccionado "Todos", al tocar un día empezamos una
      // selección individual. Evita que parezca que elegiste un solo día
      // cuando en realidad quedaron activos los otros seis.
      if(todos.classList.contains('activo')){
        todos.classList.remove('activo');
        diasCont.querySelectorAll('.dia-chip[data-dia]').forEach(x=>x.classList.remove('activo'));
        b.classList.add('activo');
      } else {
        b.classList.toggle('activo');
      }
      __corregirPrecioDias=Array.from(diasCont.querySelectorAll('.dia-chip[data-dia].activo')).map(x=>x.dataset.dia);
      if(__corregirPrecioDias.length===7){
        todos.classList.add('activo');
        diasCont.querySelectorAll('.dia-chip[data-dia]').forEach(x=>x.classList.add('activo'));
      }
    };
    diasCont.appendChild(b);
  });
  const diaActual=diaDeHoy();
  const chipActual=diasCont.querySelector('.dia-chip[data-dia="'+diaActual+'"]');
  if(chipActual){ chipActual.classList.add('activo'); __corregirPrecioDias=[diaActual]; }
  document.querySelectorAll('#modalCorregirPrecio input[type=checkbox]').forEach(x=>x.checked=false);
  document.getElementById('corregirPrecioPaso1').style.display='block';
  document.getElementById('corregirPrecioPaso2').style.display='none';
}

function mostrarPasoCorregirPrecio(){
  const dias=__corregirPrecioDias.slice();
  const productos=[];
  if(document.getElementById('chkCorregirB20').checked) productos.push('b20');
  if(document.getElementById('chkCorregirB10').checked) productos.push('b10');
  if(document.getElementById('chkCorregirDisp').checked) productos.push('disp');
  if(document.getElementById('chkCorregirSoda').checked) productos.push('soda');
  if(!dias.length){ mostrarToast('Elegí al menos un día', 'error'); return; }
  if(!productos.length){ mostrarToast('Elegí al menos un producto', 'error'); return; }
  __corregirPrecioPaso=2;
  const lista=document.getElementById('corregirPrecioCampos');
  const etiquetas={b20:'Bidón 20 Lts',b10:'Bidón 10-12 Lts',disp:'Dispenser',soda:'Soda'};
  const hoy=obtenerPreciosCliente(clientes[0]||{precio:0}, todayISO());
  lista.innerHTML=productos.map(key=>`<div class="precio-correccion-card">
    <div><strong>${etiquetas[key]}</strong><div class="precio-actual-general">Precio actual de referencia: $${formatMoney(hoy[key]||0)}</div></div>
    <div class="precio-input-wrap"><span>$</span><input type="number" min="0" step="1" id="nuevoPrecio_${key}" placeholder="Nuevo precio"></div>
  </div>`).join('');
  document.getElementById('corregirPrecioDiasResumen').textContent = dias.length===7 ? 'Todos los días' : dias.join(', ');
  document.getElementById('corregirPrecioProductosResumen').textContent = productos.map(x=>etiquetas[x]).join(', ');
  document.getElementById('corregirPrecioPaso1').style.display='none';
  document.getElementById('corregirPrecioPaso2').style.display='block';
}

function volverPasoCorregirPrecio(){
  document.getElementById('corregirPrecioPaso2').style.display='none';
  document.getElementById('corregirPrecioPaso1').style.display='block';
  __corregirPrecioPaso=1;
}

function aplicarCorregirPrecio(){
  const productos=[];
  if(document.getElementById('chkCorregirB20').checked) productos.push(['b20','precio']);
  if(document.getElementById('chkCorregirB10').checked) productos.push(['b10','precio10']);
  if(document.getElementById('chkCorregirDisp').checked) productos.push(['disp','precioDisp']);
  if(document.getElementById('chkCorregirSoda').checked) productos.push(['soda','precioSoda']);
  const nuevos={};
  for(const [key] of productos){
    const el=document.getElementById('nuevoPrecio_'+key);
    const val=el ? parseFloat(el.value) : NaN;
    if(!Number.isFinite(val) || val < 0){ mostrarToast('Completá todos los nuevos precios', 'error'); return; }
    nuevos[key]=Math.round(val);
  }
  if(!__corregirPrecioDias.length){ mostrarToast('Elegí al menos un día', 'error'); return; }

  let count=0;
  const todosLosDias = __corregirPrecioDias.length===7;
  clientes.forEach(c=>{
    const mapa=asegurarPreciosPorDia(c);

    if(todosLosDias){
      // "Todos" significa precio general para el cliente. Además de
      // actualizar el precio base, eliminamos overrides viejos para esos
      // productos. Esto evita que un precio 0 guardado anteriormente en
      // preciosPorDia siga pisando el nuevo precio.
      if(nuevos.b20!=null) c.precio=nuevos.b20;
      if(nuevos.b10!=null) c.precio10=nuevos.b10;
      if(nuevos.disp!=null) c.precioDisp=nuevos.disp;
      if(nuevos.soda!=null) c.precioSoda=nuevos.soda;

      Object.keys(mapa).forEach(dia=>{
        if(!mapa[dia] || typeof mapa[dia] !== 'object') return;
        Object.keys(nuevos).forEach(key=>{ delete mapa[dia][key]; });
        if(Object.keys(mapa[dia]).length===0) delete mapa[dia];
      });
    } else {
      // Un solo día (o varios días concretos) modifica solamente ese
      // calendario. No toca el precio general de los demás días.
      __corregirPrecioDias.forEach(dia=>{
        if(!mapa[dia] || typeof mapa[dia] !== 'object') mapa[dia]={};
        Object.keys(nuevos).forEach(key=>{ mapa[dia][key]=nuevos[key]; });
      });
    }

    syncCliente(c);
    count++;
  });
  // Guardamos primero en el teléfono y forzamos la sincronización para que
  // los precios corregidos no queden esperando a otro render o conexión.
  guardarEstado({forzarSync:true});
  cerrarModal('modalCorregirPrecio');
  renderTodo();
  const diaTexto=__corregirPrecioDias.length===7?'todos los días':__corregirPrecioDias.join(', ');
  mostrarToast('¡Listo! Precios corregidos para '+count+' clientes · '+diaTexto, 'success');
  if('vibrate' in navigator) navigator.vibrate([30,50,30]);
}

function guardarCliente(){
  const nombre = document.getElementById('inputNombre').value.trim();
  const telefono = document.getElementById('inputTelefono').value.trim();
  const direccion = document.getElementById('inputDireccion').value.trim();
  const precio = parseFloat(document.getElementById('inputPrecio').value) || 0;
  const precio10 = parseFloat(document.getElementById('inputPrecio10').value) || 0;
  const precioDisp = parseFloat(document.getElementById('inputPrecioDisp').value) || 0;
  const precioSoda = parseFloat(document.getElementById('inputPrecioSoda').value) || 0;
  const dias = diasSeleccionadosDe('diasClienteSelector');
  const ubicacionesPorDia = {};
  dias.forEach(dia=>{ const sel=document.getElementById('inputDespuesDe_'+dia); ubicacionesPorDia[dia]=sel ? sel.value : ''; });

  if(!nombre){ mostrarToast('Poné un nombre para el cliente'); return; }
  if(dias.length === 0){ mostrarToast('Elegí al menos un día de reparto'); return; }

  var nota = document.getElementById('inputNota').value.trim();
  let cliente;
  let esNuevo = !clienteSeleccionado;
  if(clienteSeleccionado){
    cliente = clientes.find(x=>x.id===clienteSeleccionado);
    cliente.nombre = nombre; cliente.telefono = telefono;
    cliente.direccion = direccion; cliente.precio = precio;
    cliente.precio10 = precio10; cliente.precioDisp = precioDisp; cliente.precioSoda = precioSoda;
    cliente.nota = nota; cliente.dias = dias;
    // Quitar orden de los días que ya no están seleccionados
    Object.keys(cliente.ordenPorDia).forEach(dia=>{
      if(!dias.includes(dia)) delete cliente.ordenPorDia[dia];
    });
  } else {
    contadorClientes++;
    cliente = {
      id: generarId(), codigo: contadorClientes, nombre, telefono, direccion, precio, precio10, precioDisp, nota, dias,
      precioSoda, saldo: 0, envasesPendientes: 0, historial: [], ordenPorDia: {}
    };
    clientes.push(cliente);
  }

  // Solo asignamos orden en la ruta para los días nuevos (si ya tenía
  // orden en un día, lo respetamos y no lo movemos de lugar al editar)
  dias.forEach(dia=>{
    if(esNuevo || cliente.ordenPorDia[dia] === undefined){
      insertarEnRuta(cliente.id, dia, ubicacionesPorDia[dia] || '');
    }
  });

  guardarEstado();
  syncCliente(cliente);
  cerrarModal('modalCliente');
  renderTodo();
}

function abrirEditarCliente(){
  const c = clientes.find(x=>x.id===clienteSeleccionado);
  if(!c) return;
  cerrarModal('modalDetalle');
  document.getElementById('tituloModalCliente').textContent = 'Editar cliente';
  document.getElementById('inputNombre').value = c.nombre;
  document.getElementById('inputTelefono').value = c.telefono || '';
  document.getElementById('inputDireccion').value = c.direccion || '';
  document.getElementById('inputPrecio').value = c.precio;
  document.getElementById('inputPrecio10').value = (c.precio10 !== undefined) ? c.precio10 : 3000;
  var notaEl = document.getElementById('inputNota');
  if(notaEl) notaEl.value = c.nota || '';
  document.getElementById('inputPrecioDisp').value = (c.precioDisp !== undefined) ? c.precioDisp : 8000;
  document.getElementById('inputPrecioSoda').value = (c.precioSoda !== undefined) ? c.precioSoda : 1500;
  renderDiasSelector('diasClienteSelector', c.dias);
  renderSelectDespuesDe();
  abrirModal('modalCliente');
}

function insertarEnRuta(clienteId, dia, despuesDeId){
  let lista = clientes
    .filter(c=>c.id!==clienteId && c.dias.includes(dia))
    .sort((a,b)=>(a.ordenPorDia[dia]||0)-(b.ordenPorDia[dia]||0))
    .map(c=>c.id);

  let insertIndex = lista.length;
  if(despuesDeId){
    const idx = lista.indexOf(despuesDeId);
    if(idx !== -1) insertIndex = idx+1;
  }
  lista.splice(insertIndex, 0, clienteId);

  lista.forEach((id,i)=>{
    const c = clientes.find(x=>x.id===id);
    c.ordenPorDia[dia] = i+1;
  });
}

function moverAlFinalDelDia(clienteId, dia){
  const c = clientes.find(x=>x.id===clienteId);
  if(!c || !c.dias.includes(dia)) return;
  const lista = clientes
    .filter(x=>x.id!==clienteId && x.dias.includes(dia))
    .sort((a,b)=>(a.ordenPorDia[dia]||0)-(b.ordenPorDia[dia]||0))
    .map(x=>x.id);
  lista.push(clienteId);
  lista.forEach((id,i)=>{
    const cli = clientes.find(x=>x.id===id);
    cli.ordenPorDia[dia] = i+1;
  });
}

function borrarCliente(){
  const c = clientes.find(x=>x.id===clienteSeleccionado);
  if(!c) return;
  document.getElementById('nombreAEliminar').textContent = c.codigo + ' - ' + c.nombre;
  abrirModal('modalConfirmarEliminar');
}

function confirmarBorrado(){
  const c = clientes.find(x=>x.id===clienteSeleccionado);
  ultimoClienteEliminado = c ? JSON.parse(JSON.stringify(c)) : null;
  if(c){ c.activo=false; }
  syncBorrarCliente(clienteSeleccionado);
  visitasHoy.delete(clienteSeleccionado); ordenVisitasHoy = ordenVisitasHoy.filter(id => id !== clienteSeleccionado);
  cerrarModal('modalConfirmarEliminar');
  cerrarModal('modalDetalle');
  renderTodo();
  mostrarBannerDeshacer(ultimoClienteEliminado ? ultimoClienteEliminado.nombre : '');
}

function mostrarBannerDeshacer(nombre){
  const banner = document.getElementById('bannerDeshacer');
  document.getElementById('bannerDeshacerTexto').textContent = 'Eliminaste a ' + nombre;
  banner.classList.add('activo');
  clearTimeout(window._deshacerTimeout);
  window._deshacerTimeout = setTimeout(()=>{
    banner.classList.remove('activo');
    ultimoClienteEliminado = null;
  }, 8000);
}

function deshacerEliminacion(){
  if(!ultimoClienteEliminado) return;
  clientes.push(ultimoClienteEliminado);
  syncCliente(ultimoClienteEliminado);
  // FIX: Reinsertar todos los movimientos del cliente en Supabase
  if(ultimoClienteEliminado.historial){
    ultimoClienteEliminado.historial.forEach(function(h){
      syncMovimiento(h, ultimoClienteEliminado.id);
    });
  }
  ultimoClienteEliminado = null;
  document.getElementById('bannerDeshacer').classList.remove('activo');
  clearTimeout(window._deshacerTimeout);
  renderTodo();
}

function abrirDetalle(id){
  clienteSeleccionado = id;
  const c = clientes.find(x=>x.id===id);
  document.getElementById('nombreDetalle').textContent = c.codigo + ' - ' + c.nombre;
  document.getElementById('diasDetalle').textContent = c.dias.join(', ') || '-';
  document.getElementById('inputPago').value = '';

  const cont = document.getElementById('botonesContacto');
  const tel = (c.telefono || '').replace(/[^0-9]/g,'');
  if(tel){
    cont.innerHTML = `
      <a class="btn chico" style="text-decoration:none; text-align:center;" href="https://wa.me/${tel}">💬 WhatsApp</a>
      <a class="btn chico outline" style="text-decoration:none; text-align:center;" href="tel:${tel}">📞 Llamar</a>
    `;
  } else {
    cont.innerHTML = '';
  }
  // Botón de Google Maps en el detalle
  const mapsCont = document.getElementById('botonesMaps');
  if(mapsCont){
    if(c.direccion){
      mapsCont.innerHTML = `<a class="btn chico outline" style="text-decoration:none; text-align:center; display:block;" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.direccion)}" target="_blank" rel="noopener">📍 Cómo llegar (Google Maps)</a>`;
    } else {
      mapsCont.innerHTML = '';
    }
  }

  // Mostrar última visita
  var ultVisitaEl = document.getElementById('ultimaVisitaDetalle');
  if(ultVisitaEl){
    var ultimaFecha = null;
    c.historial.forEach(function(h){
      if(h.tipo === 'compra' || h.tipo === 'no_compra'){
        if(!ultimaFecha || (h.fechaISO || '') > ultimaFecha) ultimaFecha = h.fechaISO;
      }
    });
    ultVisitaEl.textContent = ultimaFecha ? 'Última visita: ' + isoAFechaLabel(ultimaFecha) : 'Sin visitas registradas';
  }

  // Mostrar nota del cliente
  var notaEl = document.getElementById('notaCliente');
  if(notaEl){
    if(c.nota){
      notaEl.style.display = 'block';
      notaEl.textContent = '📝 ' + c.nota;
    } else {
      notaEl.style.display = 'none';
    }
  }

  renderDetalle(c);
  abrirModal('modalDetalle');
}

function renderDetalle(c){
  const saldoEl = document.getElementById('saldoDetalle');
  saldoEl.textContent = $(c.saldo);
  saldoEl.className = tieneDeuda(c) ? 'deuda' : 'saldo-ok';
  document.getElementById('envasesDetalle').textContent = c.envasesPendientes;

  const hist = document.getElementById('historialCliente');
  if(c.historial.length === 0){
    hist.innerHTML = '<div class="empty-msg">Sin movimientos todavía</div>';
  } else {
    hist.innerHTML = c.historial.slice().reverse().map(h=>
      `<div class="mov-item">
        <span>${formatearMovimiento(h)}</span>
        <span style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; font-size:0.75em;">
          <span>${isoAFechaLabel(h.fechaISO)}</span>
          <span>${h.hora || '-'}</span>
          <span style="display:flex; gap:4px; margin-top:2px;">
            ${(h.id && h.tipo === 'compra') ? `<button class="btn chico outline" style="padding:2px 8px;" onclick="abrirBoleta('${c.id}','${h.id}')">🧾</button>` : ''}
            ${(h.id && h.tipo === 'compra') ? `<button class="btn chico outline" style="padding:2px 8px;" onclick="compartirBoleta('${c.id}','${h.id}')">📲</button>` : ''}
            ${(h.id && h.tipo !== 'pago') ? `<button class="btn chico outline" style="padding:2px 8px;" onclick="abrirEditarMovimiento('${c.id}','${h.id}')">✏️</button>` : ''}
          </span>
        </span>
      </div>`
    ).join('');
  }
}
// ---------- DIALOGOS PROFESIONALES ----------
let confirmacionAppResolver = null;
function pedirConfirmacionApp(mensaje, titulo='Confirmar acción'){
  return new Promise(resolve=>{
    confirmacionAppResolver = resolve;
    const tituloEl=document.getElementById('confirmacionAppTitulo');
    const mensajeEl=document.getElementById('confirmacionAppMensaje');
    if(tituloEl) tituloEl.textContent=titulo;
    if(mensajeEl) mensajeEl.innerHTML=escapeHtml(mensaje).replace(/\n/g,'<br>');
    abrirModal('modalConfirmacionApp');
  });
}
function resolverConfirmacionApp(valor){
  const resolver=confirmacionAppResolver;
  confirmacionAppResolver=null;
  cerrarModal('modalConfirmacionApp');
  if(resolver) resolver(!!valor);
}

// ---------- MODAL STOCK (registrar compra) ----------
function getFormaStockSeleccionada(){
  return window._formaPagoStock || 'efectivo';
}

function seleccionarFormaStock(forma){
  window._formaPagoStock = forma;
  document.querySelectorAll('.stock-forma-btn').forEach(btn=>btn.classList.remove('activo'));
  const id = forma==='efectivo' ? 'stkFormaEfectivo' : forma==='transferencia' ? 'stkFormaTransferencia' : 'stkFormaPendiente';
  const btn=document.getElementById(id);
  if(btn) btn.classList.add('activo');

  const entrega=document.getElementById('stkEntregado');
  const ajustar=document.getElementById('stkBtnAjustarPago');
  if(entrega){
    if(forma==='transferencia_pendiente'){
      entrega.value='0';
      entrega.readOnly=true;
      entrega.disabled=true;
      entrega.placeholder='$ 0 (queda pendiente)';
      if(ajustar) ajustar.style.display='none';
    }else{
      entrega.disabled=false;
      entrega.readOnly = !window._ajustePagoStock;
      entrega.placeholder='$ 0';
      if(ajustar) ajustar.style.display='inline-flex';
      if(!window._ajustePagoStock) cargarImporteAutomaticoStock();
    }
  }
  actualizarPreviewStock();
}

function cargarImporteAutomaticoStock(){
  const c=clientes.find(x=>x.id===clienteStockId);
  const entrega=document.getElementById('stkEntregado');
  if(!c || !entrega) return;
  const b20=parseInt(document.getElementById('stkB20')?.value)||0;
  const b10=parseInt(document.getElementById('stkB10')?.value)||0;
  const disp=parseInt(document.getElementById('stkDisp')?.value)||0;
  const soda=parseInt(document.getElementById('stkSoda')?.value)||0;
  const precios=obtenerPreciosCliente(c, fechaOperativaActual());
  const costo=b20*(precios.b20||0)+b10*(precios.b10||0)+disp*(precios.disp||0)+soda*(precios.soda||0);
  const deuda=Math.max(0,Number(c.saldo||0));
  const favor=Math.max(0,Number(c.saldoAFavor||0));
  const total=Math.max(0,deuda+costo-favor);
  entrega.value=window._formaPagoStock==='transferencia_pendiente' ? '0' : Math.round(total);
}

function alternarAjustePago(){
  const entrega=document.getElementById('stkEntregado');
  const btn=document.getElementById('stkBtnAjustarPago');
  if(!entrega) return;
  window._ajustePagoStock=!window._ajustePagoStock;
  entrega.readOnly=!window._ajustePagoStock;
  if(window._ajustePagoStock){
    entrega.focus();
    entrega.select();
    if(btn) btn.textContent='↩️ Usar total automático';
  }else{
    cargarImporteAutomaticoStock();
    if(btn) btn.textContent='✏️ Ajustar importe';
  }
  actualizarPreviewStock();
}

function abrirStock(id){
  clienteStockId = id;
  const c = clientes.find(x=>x.id===id);
  if(!c) return;
  const direccion = c.domicilio || c.direccion || c.direccionEntrega || 'Sin dirección';
  document.getElementById('nombreStock').textContent = c.codigo + ' - ' + c.nombre;
  const direccionEl=document.getElementById('direccionStock');
  if(direccionEl) direccionEl.textContent= direccion;
  document.getElementById('bidonesPoderStock').textContent = c.envasesPendientes || 0;

  ['stkB20','stkB10','stkDisp','stkSoda','stkEnvB20','stkEnvB10','stkEnvSoda','stkEntregado'].forEach(id=>{
    const el=document.getElementById(id); if(el){el.value='';el.disabled=false;}
  });
  window._formaPagoStock='efectivo';
  window._ajustePagoStock=false;
  seleccionarFormaStock('efectivo');

  const precios=obtenerPreciosCliente(c, fechaOperativaActual());
  const precioIds={b20:'stkPrecioB20',b10:'stkPrecioB10',disp:'stkPrecioDisp',soda:'stkPrecioSoda'};
  Object.keys(precioIds).forEach(k=>{
    const el=document.getElementById(precioIds[k]);
    if(el) el.textContent='$'+formatMoney(precios[k]||0);
  });

  actualizarPreviewStock();
  renderHistorialStock(c);
  abrirModal('modalStock');
}

function ajustarCantidadStock(inputId, delta){
  const input = document.getElementById(inputId);
  if(!input) return;
  const actual = parseInt(input.value) || 0;
  input.value = Math.max(0, actual + delta);
  if(!window._ajustePagoStock && getFormaStockSeleccionada()!=='transferencia_pendiente') cargarImporteAutomaticoStock();
  actualizarPreviewStock();
}

function renderHistorialStock(c){
  const cont = document.getElementById('historialStock');
  if(!cont) return;
  if(!c.historial || c.historial.length === 0){
    cont.innerHTML = '<div class="empty-msg">Sin movimientos todavía</div>';
    return;
  }
  cont.innerHTML = c.historial.slice().reverse().map(h=>
    `<div class="mov-item">
      <span>${formatearMovimiento(h)}</span>
      <span style="display:flex; flex-direction:column; align-items:flex-end; gap:2px; font-size:0.75em;">
        <span>${isoAFechaLabel(h.fechaISO)}</span>
        <span>${h.hora || '-'}</span>
        ${(h.id && h.tipo === 'compra') ? `<button class="btn chico outline" style="padding:2px 8px; margin-top:2px;" onclick="abrirBoleta('${c.id}','${h.id}')">🧾</button>` : ''}
      </span>
    </div>`
  ).join('');
}

function actualizarPreviewStock(){
  const c = clientes.find(x => x.id === clienteStockId);
  if(!c) return;

  const b20 = parseInt(document.getElementById('stkB20')?.value) || 0;
  const b10 = parseInt(document.getElementById('stkB10')?.value) || 0;
  const disp = parseInt(document.getElementById('stkDisp')?.value) || 0;
  const soda = parseInt(document.getElementById('stkSoda')?.value) || 0;
  const envB20 = parseInt(document.getElementById('stkEnvB20')?.value) || 0;
  const envB10 = parseInt(document.getElementById('stkEnvB10')?.value) || 0;
  const envSoda = parseInt(document.getElementById('stkEnvSoda')?.value) || 0;

  const precios = obtenerPreciosCliente(c, fechaOperativaActual());
  const parciales={
    b20:b20*(precios.b20||0), b10:b10*(precios.b10||0),
    disp:disp*(precios.disp||0), soda:soda*(precios.soda||0)
  };
  const totalCompra=parciales.b20+parciales.b10+parciales.disp+parciales.soda;
  const deudaAnterior=Math.max(0,Number(c.saldo||0));
  const favorDisponible=Math.max(0,Number(c.saldoAFavor||0));
  const totalBruto=deudaAnterior+totalCompra;
  const favorUsado=Math.min(favorDisponible,totalBruto);
  const totalDebe=Math.max(0,totalBruto-favorUsado);
  const forma=getFormaStockSeleccionada();
  if(!window._ajustePagoStock && forma!=='transferencia_pendiente') cargarImporteAutomaticoStock();
  const entrega=forma==='transferencia_pendiente' ? 0 : Math.max(0,Number(document.getElementById('stkEntregado')?.value)||0);
  const saldoRestante=Math.max(0,totalDebe-entrega);
  const nuevoFavor=Math.max(0,entrega-totalDebe);

  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  set('stkPreview','$'+formatMoney(totalCompra));
  set('stkDeudaAnterior','$'+formatMoney(deudaAnterior));
  set('stkCompraHoy','$'+formatMoney(totalCompra));
  set('stkTotalDebe','$'+formatMoney(totalBruto));
  set('stkTotalDebePago','$'+formatMoney(totalDebe));
  set('stkSaldoRestante',nuevoFavor>0 ? '$0' : '$'+formatMoney(saldoRestante));
  set('stkParcialB20','$'+formatMoney(parciales.b20));
  set('stkParcialB10','$'+formatMoney(parciales.b10));
  set('stkParcialDisp','$'+formatMoney(parciales.disp));
  set('stkParcialSoda','$'+formatMoney(parciales.soda));
  const favorInfo=document.getElementById('stkSaldoFavorInfo');
  if(favorInfo){
    favorInfo.innerHTML = favorDisponible>0
      ? 'Saldo a favor disponible: <strong>$'+formatMoney(favorDisponible)+'</strong> · Se aplica automáticamente a esta compra.'
      : 'Saldo a favor disponible: <strong>$0</strong>';
    favorInfo.classList.toggle('hay-favor',favorDisponible>0);
  }

  const ayuda=document.getElementById('stkPagoAyuda');
  if(ayuda){
    if(forma==='transferencia_pendiente') ayuda.textContent='La transferencia queda pendiente: no se cuenta como dinero recibido hasta confirmarla.';
    else if(nuevoFavor>0) ayuda.textContent='El cliente entrega de más: quedará un saldo a favor de $'+formatMoney(nuevoFavor)+' para futuras compras.';
    else if(entrega<=0) ayuda.textContent='No entrega dinero: la compra de hoy queda como deuda.';
    else if(entrega>=totalDebe) ayuda.textContent='Pago completo: el saldo queda en $0.';
    else ayuda.textContent='El importe entregado se aplica a la compra de hoy y luego a la deuda anterior.';
  }
}

async function confirmarStock(tipo){
  const c=clientes.find(x=>x.id===clienteStockId);
  if(!c) return;
  const b20=parseInt(document.getElementById('stkB20')?.value)||0;
  const b10=parseInt(document.getElementById('stkB10')?.value)||0;
  const disp=parseInt(document.getElementById('stkDisp')?.value)||0;
  const soda=parseInt(document.getElementById('stkSoda')?.value)||0;
  const envB20=parseInt(document.getElementById('stkEnvB20')?.value)||0;
  const envB10=parseInt(document.getElementById('stkEnvB10')?.value)||0;
  const envSoda=parseInt(document.getElementById('stkEnvSoda')?.value)||0;
  const envases=envB20+envB10+envSoda;
  const precios=obtenerPreciosCliente(c, fechaOperativaActual());
  const costo=b20*(precios.b20||0)+b10*(precios.b10||0)+disp*(precios.disp||0)+soda*(precios.soda||0);
  const deudaAnterior=Math.max(0,Number(c.saldo||0));
  const favorAntes=Math.max(0,Number(c.saldoAFavor||0));
  const totalBruto=deudaAnterior+costo;
  const favorUsado=Math.min(favorAntes,totalBruto);
  const totalDebe=Math.max(0,totalBruto-favorUsado);
  const forma=tipo || getFormaStockSeleccionada();
  const montoTotalPagado=forma==='transferencia_pendiente' ? 0 : Math.max(0,parseFloat(document.getElementById('stkEntregado')?.value)||0);

  if(b20===0&&b10===0&&disp===0&&soda===0&&envases===0&&montoTotalPagado===0&&favorUsado===0){
    mostrarToast('Marcá algún producto, recibí algún envase o ingresá un pago.','warning');
    return;
  }
  if(forma==='transferencia_pendiente' && costo<=0){
    mostrarToast('La transferencia pendiente corresponde a una compra de hoy.','warning');
    return;
  }
  if(b20>stockCamion.b20||b10>stockCamion.b10||disp>stockCamion.disp||soda>(stockCamion.soda||0)){
    const continuar=await pedirConfirmacionApp(
      'Stock insuficiente en la app.\n\nTe quedan: '+stockCamion.b20+' de 20L, '+stockCamion.b10+' de 10L, '+stockCamion.disp+' dispensers y '+(stockCamion.soda||0)+' sodas.\n\nPodés registrar la venta de todos modos.',
      'Stock insuficiente'
    );
    if(!continuar) return;
  }

  const ahora=new Date();
  const repartoId=asegurarRepartoId();
  const fecha=fechaOperativaActual();

  // Primero se consume automáticamente el saldo a favor existente.
  // Se guarda en montoSaldoFavor como valor negativo para no cambiar el esquema actual de Supabase:
  // positivo = saldo a favor generado, negativo = saldo a favor consumido.
  const favorAplicado=Math.min(favorAntes,costo);
  c.saldoAFavor=Math.max(0,favorAntes-favorAplicado);

  // El pago normal se aplica primero a la compra de hoy y después a la deuda anterior.
  const pagoCompra=Math.min(montoTotalPagado,Math.max(0,costo-favorAplicado));
  const restoPago=Math.max(0,montoTotalPagado-pagoCompra);
  const pagoDeuda=Math.min(restoPago,deudaAnterior);
  const saldoFavorNuevo=Math.max(0,restoPago-pagoDeuda);

  // Sin compra: un pago directo salda deuda y, si sobra, queda a favor.
  if(costo===0 && montoTotalPagado>0){
    const aplicadoDeuda=Math.min(montoTotalPagado,deudaAnterior);
    const excedente=Math.max(0,montoTotalPagado-aplicadoDeuda);
    const entry={id:generarId(),tipo:'pago',fechaISO:fecha,repartoId,hora:ahora.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),montoPagado:montoTotalPagado,montoAplicadoDeuda:aplicadoDeuda,montoSaldoFavor:excedente,formaPago:forma};
    c.saldo=Math.max(0,deudaAnterior-aplicadoDeuda);
    c.saldoAFavor=Math.max(0,Number(c.saldoAFavor||0)+excedente);
    c.historial.push(entry);
    syncMovimiento(entry,c.id); syncCliente(c);
    cobradoHoy+=montoTotalPagado; cobroDeudaHoy+=aplicadoDeuda;
    if(forma==='efectivo') efectivoHoy+=montoTotalPagado;
    if(forma==='transferencia') transferenciaHoy+=montoTotalPagado;
    syncResumenDiario(); guardarEstado({forzarSync:true}); registrarVisitaHoy(c.id);
    cerrarModal('modalStock'); renderTodo();
    mostrarToast(excedente>0 ? 'Pago registrado. Quedó $'+formatMoney(excedente)+' a favor del cliente.':'Pago registrado: $'+formatMoney(montoTotalPagado)+'.','success');
    return;
  }

  const entry={id:generarId(),tipo:'compra',fechaISO:fecha,repartoId,hora:ahora.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
    b20,b10,disp,soda,envB20,envB10,envSoda,envases,bidones:b20+b10,costo,formaPago:forma,montoPagado:pagoCompra,
    // negativo = saldo a favor usado para pagar parte de esta compra
    montoSaldoFavor: favorAplicado>0 ? -favorAplicado : 0,
    transferenciaConfirmada:forma==='transferencia_pendiente'?false:undefined,
    preciosAplicados:precios
  };
  c.historial.push(entry);
  aplicarEfectoMovimiento(c,entry);

  if(pagoDeuda>0 || saldoFavorNuevo>0){
    const pago={id:generarId(),tipo:'pago',fechaISO:fecha,repartoId,hora:ahora.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),montoPagado:restoPago,montoAplicadoDeuda:pagoDeuda,montoSaldoFavor:saldoFavorNuevo,formaPago:forma,origen:'pago_unificado',movimientoOrigenId:entry.id};
    c.historial.push(pago);
    aplicarEfectoMovimiento(c,pago);
    syncMovimiento(pago,c.id);
  }
  syncMovimiento(entry,c.id); syncCliente(c);

  stockCamion.b20=Math.max(0,stockCamion.b20-b20);
  stockCamion.b10=Math.max(0,stockCamion.b10-b10);
  stockCamion.disp=Math.max(0,stockCamion.disp-disp);
  stockCamion.soda=Math.max(0,(stockCamion.soda||0)-soda);
  stockCamion.vaciosB20=(stockCamion.vaciosB20||0)+envB20;
  stockCamion.vaciosB10=(stockCamion.vaciosB10||0)+envB10;
  stockCamion.vaciosSoda=(stockCamion.vaciosSoda||0)+envSoda;
  syncStock(); syncResumenDiario(); registrarVisitaHoy(c.id);
  guardarEstado({forzarSync:true});
  cerrarModal('modalStock'); renderTodo();
  if(saldoFavorNuevo>0){
    mostrarToast('Venta registrada. Quedó $'+formatMoney(saldoFavorNuevo)+' a favor del cliente.','success');
  }else{
    mostrarToast('Venta registrada correctamente.','success');
  }
}

// Marcar "no compró" directo desde la tarjeta (sin abrir detalle)
function marcarNoCompraRapido(clienteId){
  var c=clientes.find(function(x){return x.id===clienteId;});
  if(!c) return;
  clienteStockId=clienteId;
  marcarNoCompra();
}

function marcarNoCompra(){
  const c = clientes.find(x=>x.id===clienteStockId);
  const ahora = new Date();
  const entry = {
    id: generarId(),
    tipo: 'no_compra',
    fechaISO: fechaOperativaActual(),
    repartoId: asegurarRepartoId(),
    hora: ahora.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'})
  };
  c.historial.push(entry);
  syncMovimiento(entry, c.id);
  registrarVisitaHoy(c.id);
  // FIX: No mover al final del dia - preserva el orden de la ruta
  // // FIX: No mover al final del dia - preserva el orden de la ruta
  // FIX: Vibración de confirmación
  if('vibrate' in navigator) navigator.vibrate(30);
  cerrarModal('modalStock');
  renderTodo();
}

// ---------- PAGOS (saldar deuda vieja) ----------
function registrarPago(formaPago){
  const c = clientes.find(x=>x.id===clienteSeleccionado);
  const monto = parseFloat(document.getElementById('inputPago').value) || 0;
  if(monto <= 0) return;
  const deudaAntes = Math.max(0, Number(c.saldo || 0));
  const aplicadoDeuda = Math.min(monto, deudaAntes);
  const excedente = Math.max(0, monto - aplicadoDeuda);
  formaPago = formaPago === 'transferencia' ? 'transferencia' : 'efectivo';

  c.saldo = Math.max(0, deudaAntes - aplicadoDeuda);
  c.saldoAFavor = Number(c.saldoAFavor || 0) + excedente;
  const ahora = new Date();
  const entry = {
    id: generarId(),
    tipo: 'pago',
    fechaISO: fechaOperativaActual(),
    repartoId: asegurarRepartoId(),
    hora: ahora.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'}),
    montoPagado: monto,
    montoAplicadoDeuda: aplicadoDeuda,
    montoSaldoFavor: excedente,
    formaPago: formaPago
  };
  c.historial.push(entry);
  syncMovimiento(entry, c.id);
  syncCliente(c);

  cobradoHoy += monto;
  cobroDeudaHoy += aplicadoDeuda;
  if(formaPago === 'efectivo') efectivoHoy += monto;
  else if(formaPago === 'transferencia') transferenciaHoy += monto;
  syncResumenDiario();

  document.getElementById('inputPago').value = '';
  renderDetalle(c);
  renderTodo();
}

// ---------- EFECTOS DE MOVIMIENTOS (aplicar / revertir) ----------
// ---------- TRANSFERENCIAS PENDIENTES ----------
let transferenciaModalClienteId = null;
let transferenciaModalEntryId = null;

function abrirModalTransferenciaRecibida(clienteId, entryId){
  const c = clientes.find(x=>x.id===clienteId);
  if(!c) return;
  const entry = c.historial.find(h=>h.id===entryId);
  if(!entry || entry.formaPago !== 'transferencia_pendiente' || entry.transferenciaConfirmada) return;

  transferenciaModalClienteId = clienteId;
  transferenciaModalEntryId = entryId;

  const recibido = Number(entry.transferenciaRecibidaAcumulada || 0);
  const pendienteVenta = Math.max(0, Number(entry.costo || 0) - recibido);
  const totalDeuda = Math.max(0, Number(c.saldo || 0));

  document.getElementById('transferenciaClienteNombre').textContent = c.nombre || 'Cliente';
  document.getElementById('transferenciaVentaMonto').textContent = '$' + formatMoney(entry.costo || 0);
  document.getElementById('transferenciaDeudaAnterior').textContent = '$' + formatMoney(Math.max(0, totalDeuda - pendienteVenta));
  document.getElementById('transferenciaPendienteVenta').textContent = '$' + formatMoney(pendienteVenta);
  document.getElementById('transferenciaMontoRecibido').value = '';
  document.getElementById('transferenciaSaldoPreview').textContent = '$' + formatMoney(totalDeuda);
  document.getElementById('transferenciaAplicadoPreview').textContent = '$0';
  document.getElementById('transferenciaPendientePreview').textContent = '$' + formatMoney(pendienteVenta);
  abrirModal('modalTransferenciaRecibida');
}

function actualizarPreviewTransferenciaRecibida(){
  if(!transferenciaModalClienteId || !transferenciaModalEntryId) return;
  const c = clientes.find(x=>x.id===transferenciaModalClienteId);
  const entry = c && c.historial.find(h=>h.id===transferenciaModalEntryId);
  if(!c || !entry) return;
  const monto = Math.max(0, parseFloat(document.getElementById('transferenciaMontoRecibido').value) || 0);
  const pendienteVenta = Math.max(0, Number(entry.costo||0) - Number(entry.transferenciaRecibidaAcumulada||0));
  const totalDeuda = Math.max(0, Number(c.saldo||0));
  const aplicado = Math.min(monto, totalDeuda);
  const aplicadoVenta = Math.min(aplicado, pendienteVenta);
  const pendiente = Math.max(0, pendienteVenta - aplicadoVenta);
  const saldo = Math.max(0, totalDeuda - aplicado);
  const favor = Math.max(0, monto - totalDeuda);

  document.getElementById('transferenciaSaldoPreview').textContent = favor > 0
    ? '$0 (saldo a favor $' + formatMoney(favor) + ')'
    : '$' + formatMoney(saldo);
  document.getElementById('transferenciaAplicadoPreview').textContent = '$' + formatMoney(aplicado);
  document.getElementById('transferenciaPendientePreview').textContent = '$' + formatMoney(pendiente);
}

async function confirmarTransferenciaRecibida(){
  const c = clientes.find(x=>x.id===transferenciaModalClienteId);
  if(!c) return;
  const entry = c.historial.find(h=>h.id===transferenciaModalEntryId);
  if(!entry || entry.formaPago !== 'transferencia_pendiente' || entry.transferenciaConfirmada) return;

  const monto = Math.max(0, parseFloat(document.getElementById('transferenciaMontoRecibido').value) || 0);
  if(monto <= 0){ mostrarToast('Ingresá el monto que realmente recibiste.', 'warning'); return; }

  const deudaAntes = Math.max(0, Number(c.saldo || 0));
  if(monto > deudaAntes){
    const excedente = monto - deudaAntes;
    const continuar = await pedirConfirmacionApp('El cliente debe $' + formatMoney(deudaAntes) + ' y recibiste $' + formatMoney(monto) + '.\n\nQuedará un saldo a favor de $' + formatMoney(excedente) + '.', 'Pago mayor a la deuda');
    if(!continuar) return;
  }

  const recibidoAnterior = Number(entry.transferenciaRecibidaAcumulada || 0);
  const pendienteVentaAntes = Math.max(0, Number(entry.costo||0) - recibidoAnterior);
  const aplicado = Math.min(monto, deudaAntes);
  const aplicadoVenta = Math.min(aplicado, pendienteVentaAntes);

  // El pago real es un movimiento independiente. La venta conserva su monto original (0 en pendiente).
  const ahora = new Date();
  const pago = {
    id: generarId(),
    tipo: 'pago',
    fechaISO: fechaOperativaActual(),
    repartoId: asegurarRepartoId(),
    hora: ahora.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
    montoPagado: monto,
    montoAplicadoDeuda: aplicado,
    montoSaldoFavor: Math.max(0, monto - deudaAntes),
    formaPago: 'transferencia',
    origen: 'transferencia_pendiente',
    movimientoOrigenId: entry.id
  };

  c.saldo = Math.max(0, deudaAntes - aplicado);
  if(monto > deudaAntes) c.saldoAFavor = Number(c.saldoAFavor || 0) + (monto - deudaAntes);

  entry.transferenciaRecibidaAcumulada = recibidoAnterior + aplicadoVenta;
  entry.transferenciaConfirmada = entry.transferenciaRecibidaAcumulada >= Number(entry.costo||0);
  entry.ultimoPagoTransferenciaId = pago.id;
  entry.ultimaTransferenciaRecibidaEn = ahora.toISOString();
  entry.transferenciaPendienteMonto = Math.max(0, Number(entry.costo||0) - entry.transferenciaRecibidaAcumulada);

  c.historial.push(pago);
  syncMovimiento(pago, c.id);
  syncActualizarMovimiento(entry, c.id);
  syncCliente(c);

  cobradoHoy += aplicado;
  cobroDeudaHoy += aplicado;
  transferenciaHoy += aplicado;
  if(movimientoPerteneceAlRepartoActual(entry)){
    deudaGeneradaHoy = Math.max(0, deudaGeneradaHoy - aplicadoVenta);
  }

  syncResumenDiario();
  guardarEstado({forzarSync:true});
  cerrarModal('modalTransferenciaRecibida');
  transferenciaModalClienteId = null;
  transferenciaModalEntryId = null;
  mostrarToast(entry.transferenciaConfirmada
    ? 'Transferencia recibida y venta saldada.'
    : 'Pago registrado. Quedó saldo pendiente de la transferencia.', 'success');
  renderTransferenciasPendientes();
  renderTodo();
}

// Compatibilidad con llamadas antiguas: ahora abre el registro de importe real.
function marcarTransferenciaRecibida(clienteId, entryId){
  abrirModalTransferenciaRecibida(clienteId, entryId);
}

function listaTransferenciasPendientes(){
  const pendientes = [];
  clientes.forEach(c=>{
    c.historial.forEach(h=>{
      if(h.formaPago === 'transferencia_pendiente' && !h.transferenciaConfirmada){
        pendientes.push({cliente: c, entry: h});
      }
    });
  });
  pendientes.sort((a,b)=> (a.entry.fechaISO+a.entry.hora).localeCompare(b.entry.fechaISO+b.entry.hora));
  return pendientes;
}

function mostrarTransferenciasPendientes(){
  cerrarMenus();
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-transferenciasPendientes').classList.add('active');
  renderTransferenciasPendientes();
}

function renderTransferenciasPendientes(){
  const pendientes = listaTransferenciasPendientes();
  const cont = document.getElementById('listaTransferenciasPendientes');
  const hoy = todayISO();

  if(pendientes.length === 0){
    cont.innerHTML = '<div class="empty-msg">No tenés transferencias pendientes 🎉</div>';
  } else {
    // CORRECCIÓN XSS: escapeHtml en nombre
    cont.innerHTML = pendientes.map(p=>{
      const esDeHoy = p.entry.fechaISO === hoy;
      const tel = (p.cliente.telefono || '').replace(/[^0-9]/g,'');
      const plantilla=localStorage.getItem('aguatero_v2_mensajeTransferenciaPendiente') || 'Hola [NOMBRE] 👋 Te recuerdo que quedó pendiente la transferencia de $[MONTO] correspondiente al reparto del [FECHA]. Cuando puedas, por favor realizala. ¡Gracias!';
      const mensaje=plantilla.replaceAll('[NOMBRE]',p.cliente.nombre||'').replaceAll('[MONTO]','$'+formatMoney(p.entry.costo)).replaceAll('[FECHA]',isoAFechaLabel(p.entry.fechaISO));
      const linkWhatsApp = tel ? `https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}` : null;
      return `
        <div class="card" style="${esDeHoy ? '' : 'border:2px solid var(--rojo-deuda, #c0392b);'}">
          <h3>${p.cliente.codigo} - ${escapeHtml(p.cliente.nombre)} ${!esDeHoy ? '⚠️' : ''}</h3>
          <div class="row"><span>Compra:</span><strong>$${formatMoney(p.entry.costo)}</strong></div>
          ${p.entry.transferenciaRecibidaAcumulada ? `<div class="row"><span>Recibido:</span><strong>$${formatMoney(p.entry.transferenciaRecibidaAcumulada)}</strong></div>` : ''}
          <div class="row"><span>Pendiente de esta transferencia:</span><strong class="deuda">$${formatMoney(Math.max(0,(p.entry.costo||0)-(p.entry.transferenciaRecibidaAcumulada||0)))}</strong></div>
          <div class="row"><span>Fecha del bidón:</span><span>${isoAFechaLabel(p.entry.fechaISO)} ${p.entry.hora||''}</span></div>
          <div class="btn-row" style="margin-top:8px;">
            <button class="btn verde chico" onclick="abrirModalTransferenciaRecibida('${p.cliente.id}','${p.entry.id}')">✅ Ya la recibí</button>
            ${linkWhatsApp ? `<a class="btn chico outline" style="text-decoration:none; text-align:center;" href="${linkWhatsApp}">📲 Recordar</a>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

function aplicarEfectoMovimiento(c,entry){
  if(entry.tipo==='compra'){
    const favorUsado = Math.max(0, -Number(entry.montoSaldoFavor || 0));
    c.saldo += Math.max(0, (entry.costo || 0) - favorUsado);
    c.saldo -= entry.montoPagado || 0;
    if(favorUsado > 0) c.saldoAFavor = Math.max(0, Number(c.saldoAFavor || 0) - favorUsado);
    c.envasesPendientes += (entry.bidones||0) + (entry.soda||0) - (entry.envases||0);
    if(c.envasesPendientes<0) c.envasesPendientes=0;
    if(movimientoPerteneceAlRepartoActual(entry)){
      ventaHoy += entry.costo || 0;
      cobradoHoy += entry.montoPagado || 0;
      if(entry.formaPago==='efectivo') efectivoHoy += entry.montoPagado || 0;
      if(entry.formaPago==='transferencia' ||

         (entry.formaPago==='transferencia_pendiente' && entry.transferenciaConfirmada)){

        transferenciaHoy += entry.montoPagado || 0;

      }
      if(entry.formaPago==='entregado') entregadoHoy += entry.montoPagado || 0;
      const faltante=(entry.costo||0)-(entry.montoPagado||0);
      if(faltante>0) deudaGeneradaHoy += faltante;
      envasesEntregadosHoy += (entry.bidones || 0) + (entry.soda || 0);
      envasesRecibidosHoy += entry.envases != null ? entry.envases : ((entry.envB20||0)+(entry.envB10||0));
      envasesRecibidosB20Hoy += entry.envB20 || 0;
      envasesRecibidosB10Hoy += entry.envB10 || 0;
      b20VendidosHoy += entry.b20||0; b10VendidosHoy += entry.b10||0; dispVendidosHoy += entry.disp||0; sodaVendidasHoy += entry.soda||0;
    }
  }else if(entry.tipo==='pago'){
    const aplicadoDeuda = Number.isFinite(Number(entry.montoAplicadoDeuda))
      ? Math.max(0, Number(entry.montoAplicadoDeuda))
      : Math.max(0, Number(entry.montoPagado || 0));
    const saldoFavor = Math.max(0, Number(entry.montoSaldoFavor || 0));
    c.saldo = Math.max(0, (c.saldo || 0) - aplicadoDeuda);
    if(saldoFavor > 0) c.saldoAFavor = Number(c.saldoAFavor || 0) + saldoFavor;
    if(movimientoPerteneceAlRepartoActual(entry)){ cobradoHoy += entry.montoPagado || 0; cobroDeudaHoy += entry.montoPagado || 0; }
  }
}

function revertirEfectoMovimiento(c,entry){
  if(entry.tipo==='compra'){
    const favorUsado = Math.max(0, -Number(entry.montoSaldoFavor || 0));
    c.saldo -= Math.max(0, (entry.costo||0) - favorUsado) - (entry.montoPagado||0);
    if(favorUsado > 0) c.saldoAFavor = Number(c.saldoAFavor || 0) + favorUsado;
    c.envasesPendientes -= (entry.bidones||0) + (entry.soda||0) - (entry.envases||0);
    if(c.envasesPendientes<0) c.envasesPendientes=0;
    if(movimientoPerteneceAlRepartoActual(entry)){
      ventaHoy -= entry.costo||0;
      cobradoHoy -= entry.montoPagado||0;
      if(entry.formaPago==='efectivo') efectivoHoy -= entry.montoPagado||0;
      if(entry.formaPago==='transferencia' ||
         (entry.formaPago==='transferencia_pendiente' && entry.transferenciaConfirmada)){
        transferenciaHoy -= entry.montoPagado || 0;
      }
      if(entry.formaPago==='entregado') entregadoHoy -= entry.montoPagado||0;
      const faltante=(entry.costo||0)-(entry.montoPagado||0);
      if(faltante>0) deudaGeneradaHoy -= faltante;
      envasesEntregadosHoy -= (entry.bidones||0) + (entry.soda||0);
      envasesRecibidosHoy -= entry.envases != null ? entry.envases : ((entry.envB20||0)+(entry.envB10||0));
      envasesRecibidosB20Hoy -= entry.envB20||0;
      envasesRecibidosB10Hoy -= entry.envB10||0;
      b20VendidosHoy -= entry.b20||0; b10VendidosHoy -= entry.b10||0; dispVendidosHoy -= entry.disp||0; sodaVendidasHoy -= entry.soda||0;
    }
  }else if(entry.tipo==='pago'){
    if(movimientoPerteneceAlRepartoActual(entry)){ cobradoHoy -= entry.montoPagado || 0; cobroDeudaHoy -= entry.montoPagado || 0; }
    const aplicadoDeuda = Number.isFinite(Number(entry.montoAplicadoDeuda))
      ? Math.max(0, Number(entry.montoAplicadoDeuda))
      : Math.max(0, Number(entry.montoPagado || 0));
    const saldoFavor = Math.max(0, Number(entry.montoSaldoFavor || 0));
    c.saldo = Number(c.saldo || 0) + aplicadoDeuda;
    if(saldoFavor > 0) c.saldoAFavor = Math.max(0, Number(c.saldoAFavor || 0) - saldoFavor);
  }
}

// ---------- COMPARTIR BOLETA POR WHATSAPP ----------
function compartirBoleta(clienteId, entryId){
  var c = clientes.find(function(x){ return x.id === clienteId; });
  if(!c) return;
  var entry = c.historial.find(function(h){ return h.id === entryId; });
  if(!entry || entry.tipo !== 'compra') return;

  var preciosBoleta = entry.preciosAplicados || obtenerPreciosCliente(c, entry.fechaISO);
  var lineas = [];
  lineas.push('\ud83d\udce8 COMPROBANTE - ' + (usuarioActual.nombreMarca || 'Aguatero'));
  lineas.push('Cliente: ' + c.nombre);
  lineas.push('Fecha: ' + isoAFechaLabel(entry.fechaISO) + ' ' + (entry.hora || ''));
  lineas.push('');
  if(entry.b20) lineas.push('Bid\u00f3n 20 Lts: ' + entry.b20 + ' x $' + formatMoney(preciosBoleta.b20) + ' = $' + formatMoney(entry.b20 * preciosBoleta.b20));
  if(entry.b10) lineas.push('Bid\u00f3n 10-12 Lts: ' + entry.b10 + ' x $' + formatMoney(preciosBoleta.b10) + ' = $' + formatMoney(entry.b10 * preciosBoleta.b10));
  if(entry.disp) lineas.push('Dispenser: ' + entry.disp + ' x $' + formatMoney(preciosBoleta.disp) + ' = $' + formatMoney(entry.disp * preciosBoleta.disp));
  if(entry.soda) lineas.push('Soda: ' + entry.soda + ' x $' + formatMoney(preciosBoleta.soda) + ' = $' + formatMoney(entry.soda * preciosBoleta.soda));
  if(entry.envases) lineas.push('Envases devueltos: ' + entry.envases);
  lineas.push('');
  lineas.push('TOTAL: $' + formatMoney(entry.costo));
  if(entry.montoPagado < entry.costo){
    lineas.push('Pagado: $' + formatMoney(entry.montoPagado));
    lineas.push('Saldo pendiente: $' + formatMoney(entry.costo - entry.montoPagado));
  } else {
    lineas.push('Pagado: $' + formatMoney(entry.montoPagado) + ' (completo)');
  }
  lineas.push('');
  lineas.push('Saldo total del cliente: $' + formatMoney(c.saldo));
  lineas.push('Envases que debe: ' + c.envasesPendientes);

  var texto = lineas.join('\n');
  var tel = (c.telefono || '').replace(/[^0-9]/g, '');
  var url = tel
    ? 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto)
    : 'https://wa.me/?text=' + encodeURIComponent(texto);
  // FIX: antes usaba window.open(), poco confiable en WebView/PWA de Android.
  // Se usa el mismo método (link + click) que ya andaba bien en el resumen del día.
  abrirWhatsAppConTextoYUrl(url);
}

// Igual que abrirWhatsAppConTexto pero recibe la URL ya armada (con o sin teléfono)
function abrirWhatsAppConTextoYUrl(url){
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.style.display='none';
  document.body.appendChild(a); a.click();
  setTimeout(()=>a.remove(),1000);
}

// ---------- BOLETA / COMPROBANTE ----------
function abrirBoleta(clienteId, entryId){
  const c = clientes.find(x=>x.id===clienteId);
  const entry = c.historial.find(h=>h.id===entryId);
  if(!c || !entry || entry.tipo !== 'compra') return;

  // FIX: usar la marca del repartidor logueado en vez de "LA NORIA" fijo
  const marcaBoleta = (usuarioActual && usuarioActual.nombreMarca) || 'Aguatero';
  const preciosBoleta = entry.preciosAplicados || obtenerPreciosCliente(c, entry.fechaISO);
  const lineas = [];
  lineas.push('🧾 ' + marcaBoleta + ' - Comprobante');
  lineas.push('Fecha: ' + isoAFechaLabel(entry.fechaISO) + ' ' + (entry.hora||''));
  lineas.push('Cliente: ' + c.nombre);
  if(c.direccion) lineas.push('Dirección: ' + c.direccion);
  lineas.push('');
  if(entry.b20) lineas.push(`Bidón 20 Lts: ${entry.b20} x $${preciosBoleta.b20} = $${formatMoney(entry.b20*preciosBoleta.b20)}`);
  if(entry.b10) lineas.push(`Bidón 10-12 Lts: ${entry.b10} x $${preciosBoleta.b10} = $${formatMoney(entry.b10*preciosBoleta.b10)}`);
  if(entry.disp) lineas.push(`Dispenser: ${entry.disp} x $${preciosBoleta.disp} = $${formatMoney(entry.disp*preciosBoleta.disp)}`);
  if(entry.envases) lineas.push(`Envases vacíos devueltos: ${entry.envases}`);
  lineas.push('');
  lineas.push('TOTAL: $' + formatMoney(entry.costo));
  const formaPagoTexto = entry.formaPago==='efectivo' ? 'Efectivo'
    : entry.formaPago==='transferencia' ? 'Transferencia'
    : entry.formaPago==='transferencia_pendiente' ? 'Transferencia (pendiente de confirmar)'
    : 'Entregado parcial / fiado';
  lineas.push('Forma de pago: ' + formaPagoTexto);
  if(entry.montoPagado < entry.costo){
    lineas.push('Saldo pendiente de esta compra: $' + formatMoney(entry.costo - entry.montoPagado));
  }
  lineas.push('');
  lineas.push('¡Gracias por su compra! - ' + marcaBoleta);

  const texto = lineas.join('\n');
  document.getElementById('boletaTexto').value = texto;

  const tel = (c.telefono || '').replace(/[^0-9]/g,'');
  const btn = document.getElementById('btnBoletaWhatsApp');
  if(tel){
    btn.href = `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
    btn.style.display = 'block';
  } else {
    btn.style.display = 'none';
  }

  abrirModal('modalBoleta');
}

function copiarBoleta(){
  const textarea = document.getElementById('boletaTexto');
  textarea.select();
  try{
    navigator.clipboard.writeText(textarea.value).then(()=>{
      mostrarToast('Copiado - ya podés pegarlo donde quieras', 'success');
    }).catch(()=>{
      document.execCommand('copy');
      mostrarToast('Copiado', 'success');
    });
  }catch(e){
    document.execCommand('copy');
    mostrarToast('Copiado', 'success');
  }
}

function formatearMovimiento(entry){
  const etiquetaPago=entry.formaPago==='efectivo'?'Efectivo':entry.formaPago==='transferencia'?'Transferencia':entry.formaPago==='transferencia_pendiente'?'Transferencia pendiente':entry.formaPago==='entregado'?'Parcial / Fiado':'';
  if(entry.tipo==='pago') return `Pago de $${formatMoney(entry.montoPagado||0)} · ${isoAFechaLabel(entry.fechaISO)} ${entry.hora||''}`;
  if(entry.tipo==='no_compra') return `No compró · ${isoAFechaLabel(entry.fechaISO)} ${entry.hora||''}`;
  const items=[];
  if(entry.b20) items.push(`${entry.b20} bidón 20L`);
  if(entry.b10) items.push(`${entry.b10} bidón 10-12L`);
  if(entry.disp) items.push(`${entry.disp} dispenser`);
  if(entry.soda) items.push(`${entry.soda} soda`);
  const detalle=items.length?items.join(' + '):`${entry.bidones||0} bidón(es)`;
  const vacios=[];
  if(entry.envB20) vacios.push(`${entry.envB20} vacío 20L`);
  if(entry.envB10) vacios.push(`${entry.envB10} vacío 10-12L`);
  if(entry.envSoda) vacios.push(`${entry.envSoda} vacío soda`);
  const detalleVacios=vacios.length?' · recibió '+vacios.join(' + '):'';
  return `Compró ${detalle} ($${formatMoney(entry.costo||0)}) · ${etiquetaPago}${detalleVacios}`;
}

// ---------- EDITAR UN MOVIMIENTO DEL HISTORIAL ----------
let movimientoEditando = null;

function abrirEditarMovimiento(clienteId,entryId){
  const c=clientes.find(x=>x.id===clienteId); if(!c) return;
  const entry=c.historial.find(h=>h.id===entryId); if(!entry) return;
  movimientoEditando={clienteId,entryId};
  const compra=entry.tipo==='compra';
  document.getElementById('camposEditCompra').style.display=compra?'block':'none';
  document.getElementById('editB20').value=entry.b20||0;
  document.getElementById('editB10').value=entry.b10||0;
  document.getElementById('editDisp').value=entry.disp||0;
  document.getElementById('editSoda').value=entry.soda||0;
  const e20=document.getElementById('editEnvB20'), e10=document.getElementById('editEnvB10'), eSoda=document.getElementById('editEnvSoda');
  if(e20) e20.value=entry.envB20||0;
  if(e10) e10.value=entry.envB10||0;
  if(eSoda) eSoda.value=entry.envSoda||0;
  document.getElementById('editEnvases').value=entry.envases||((entry.envB20||0)+(entry.envB10||0)+(entry.envSoda||0));
  document.getElementById('editFormaPago').value=entry.formaPago||'efectivo';
  toggleEditMontoEntregado(); // CORRECCIÓN: mostrar/ocultar según el valor cargado
  abrirModal('modalEditarMov');
}

function setTipoEdicion(tipo){
  const esCompra = tipo === 'compra';
  document.getElementById('camposEditCompra').style.display = esCompra ? 'block' : 'none';
  document.getElementById('btnEditCompro').className = 'btn' + (esCompra ? '' : ' outline');
  document.getElementById('btnEditNoCompro').className = 'btn' + (esCompra ? ' outline' : '');
  document.getElementById('camposEditCompra').dataset.tipo = tipo;
}

function toggleEditMontoEntregado(){
  const forma = document.getElementById('editFormaPago').value;
  document.getElementById('editMontoEntregadoWrap').style.display = forma === 'entregado' ? 'block' : 'none';
}

function guardarEdicionMovimiento(){
  if(!movimientoEditando) return;
  const c=clientes.find(x=>x.id===movimientoEditando.clienteId); if(!c) return;
  const entry=c.historial.find(h=>h.id===movimientoEditando.entryId); if(!entry) return;
  const viejo=entry.tipo==='compra'?{b20:entry.b20||0,b10:entry.b10||0,disp:entry.disp||0,soda:entry.soda||0,envB20:entry.envB20||0,envB10:entry.envB10||0,envSoda:entry.envSoda||0}:{b20:0,b10:0,disp:0,soda:0,envB20:0,envB10:0,envSoda:0};
  revertirEfectoMovimiento(c,entry);
  const nuevoTipo=document.getElementById('camposEditCompra').dataset.tipo;
  entry.tipo=nuevoTipo;
  let nuevo={b20:0,b10:0,disp:0,soda:0,envB20:0,envB10:0,envSoda:0};
  if(nuevoTipo==='compra'){
    const b20=parseInt(document.getElementById('editB20').value)||0;
  const b10=parseInt(document.getElementById('editB10').value)||0;
const disp=parseInt(document.getElementById('editDisp').value)||0;
const soda=parseInt(document.getElementById('editSoda').value)||0;
const e20El=document.getElementById('editEnvB20'), e10El=document.getElementById('editEnvB10'), eSodaEl=document.getElementById('editEnvSoda');
const envB20=e20El?parseInt(e20El.value)||0:0;
const envB10=e10El?parseInt(e10El.value)||0:0;
const envSoda=eSodaEl?parseInt(eSodaEl.value)||0:0;
const envases=envB20+envB10+envSoda;
const formaPago=document.getElementById('editFormaPago').value;
const precios = obtenerPreciosCliente(c, entry.fechaISO || todayISO());
const costo=b20*precios.b20+b10*precios.b10+disp*precios.disp+soda*precios.soda;
let montoPagado=0;
if(formaPago==='efectivo'||formaPago==='transferencia') montoPagado=costo;
else if(formaPago==='entregado') montoPagado=parseFloat(document.getElementById('editMontoEntregado').value)||0;
entry.b20=b20;entry.b10=b10;entry.disp=disp;entry.soda=soda;entry.bidones=b20+b10;entry.envB20=envB20;entry.envB10=envB10;entry.envSoda=envSoda;entry.envases=envases;
entry.costo=costo;entry.formaPago=formaPago;entry.montoPagado=montoPagado;entry.transferenciaConfirmada=formaPago==='transferencia_pendiente'?false:undefined;entry.preciosAplicados=precios;
nuevo={b20,b10,disp,soda,envB20,envB10,envSoda};
}
if(movimientoPerteneceAlRepartoActual(entry)){
stockCamion.b20=Math.max(0,stockCamion.b20+viejo.b20-nuevo.b20);
stockCamion.b10=Math.max(0,stockCamion.b10+viejo.b10-nuevo.b10);
stockCamion.disp=Math.max(0,stockCamion.disp+viejo.disp-nuevo.disp);
stockCamion.soda=Math.max(0,stockCamion.soda+viejo.soda-nuevo.soda);
stockCamion.vaciosB20=Math.max(0,(stockCamion.vaciosB20||0)+nuevo.envB20-viejo.envB20);
stockCamion.vaciosB10=Math.max(0,(stockCamion.vaciosB10||0)+nuevo.envB10-viejo.envB10);
stockCamion.vaciosSoda=Math.max(0,(stockCamion.vaciosSoda||0)+nuevo.envSoda-viejo.envSoda);
}
aplicarEfectoMovimiento(c,entry);syncActualizarMovimiento(entry,c.id);syncCliente(c);syncStock();
movimientoEditando=null;cerrarModal('modalEditarMov');renderDetalle(c);renderTodo();
}

// ---------- ANULAR VENTA (deshacer del todo) ----------
function confirmarAnularMovimiento(){
if(!movimientoEditando) return;

// No obligamos al usuario a cerrar primero "Corregir movimiento".
cerrarModal('modalEditarMov');
abrirModal('modalConfirmarAnular');
}

function anularMovimiento(){
if(!movimientoEditando) return;
const c = clientes.find(x=>x.id===movimientoEditando.clienteId);
const entry = c.historial.find(h=>h.id===movimientoEditando.entryId);
if(!c || !entry) return;

// Revertimos todo lo que ese movimiento haya sumado (venta, cobrado, deuda, envases)
revertirEfectoMovimiento(c, entry);

// Si era una venta de hoy, le devolvemos los bidones al stock del camión
if(entry.tipo === 'compra' && movimientoPerteneceAlRepartoActual(entry)){
stockCamion.b20 += (entry.b20 || 0);
stockCamion.b10 += (entry.b10 || 0);
stockCamion.disp += (entry.disp || 0);
  stockCamion.soda += (entry.soda || 0);
stockCamion.vaciosB20=Math.max(0,(stockCamion.vaciosB20||0)-(entry.envB20||0));
stockCamion.vaciosB10=Math.max(0,(stockCamion.vaciosB10||0)-(entry.envB10||0));
stockCamion.vaciosSoda=Math.max(0,(stockCamion.vaciosSoda||0)-(entry.envSoda||0));
}

c.historial = c.historial.filter(h=>h.id !== entry.id);
syncBorrarMovimiento(entry.id);
syncCliente(c);
syncStock();

// FIX: Remover de visitasHoy si no tiene otros movimientos del día
const tieneOtrosHoy = c.historial.some(h => (h.repartoId ? h.repartoId === repartoActualId : h.fechaISO === fechaContadores) && h.id !== entry.id);
if(!tieneOtrosHoy){
visitasHoy.delete(c.id);
  ordenVisitasHoy = ordenVisitasHoy.filter(id => id !== c.id);
}
movimientoEditando = null;
cerrarModal('modalConfirmarAnular');
cerrarModal('modalEditarMov');
renderDetalle(c);
renderTodo();
}

// ---------- VISITAS POR FECHA ----------
function cambiarSubtabHistorial(sub){
const esFecha = sub === 'fecha';
document.getElementById('histPorFecha').style.display = esFecha ? 'block' : 'none';
document.getElementById('histPorCliente').style.display = esFecha ? 'none' : 'block';
document.getElementById('btnHistPorFecha').className = 'btn' + (esFecha ? '' : ' outline');
document.getElementById('btnHistPorCliente').className = 'btn' + (esFecha ? ' outline' : '');
if(!esFecha) renderHistorialPorCliente();
}

function renderHistorialPorCliente(){
const termino = (document.getElementById('inputBuscarClienteHist').value || '').trim().toLowerCase();
const cont = document.getElementById('listaHistorialPorCliente');
if(!termino){
cont.innerHTML = '<div class="empty-msg">Escribí el nombre de un cliente para ver sus compras</div>';
return;
}
const encontrados = clientes.filter(c=>c.nombre.toLowerCase().includes(termino));
if(encontrados.length === 0){
cont.innerHTML = '<div class="empty-msg">No se encontró ningún cliente</div>';
return;
}
// CORRECCIÓN XSS: escapeHtml en nombre
cont.innerHTML = encontrados.map(c=>{
const movimientos = c.historial.slice().reverse().map(h=>
`<div class="mov-item"><span>${formatearMovimiento(h)}</span><span>${isoAFechaLabel(h.fechaISO)} ${h.hora||''}</span></div>`
).join('') || '<div class="empty-msg">Sin movimientos todavía</div>';
const fueraDeRuta = !c.dias.includes(diaSeleccionado);
const yaAgregado = clientesFueraRutaHoy.has(c.id);
const botonAgregar = (fueraDeRuta && !yaAgregado)
? `<button class="btn chico naranja" style="margin-top:8px;" onclick="agregarAFueraDeReparto('${c.id}')">🚚➕ Agregar a fuera de reparto de hoy</button>`
: (fueraDeRuta && yaAgregado ? `<div style="color:var(--verde-pago); font-weight:bold; margin-top:8px;">✅ Ya está en fuera de reparto de hoy</div>` : '');
return `<div class="card"><h3>${c.codigo} - ${escapeHtml(c.nombre)}</h3><div class="movimientos">${movimientos}</div>${botonAgregar}</div>`;
}).join('');
}

function mostrarHistorialFecha(){
cerrarMenus();
document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
document.getElementById('view-historialFecha').classList.add('active');
document.getElementById('inputFechaHistorial').value = todayISO();
cambiarSubtabHistorial('fecha');
renderHistorialFecha();
}

function renderHistorialFecha(){
const fecha = document.getElementById('inputFechaHistorial').value;
const cont = document.getElementById('listaHistorialFecha');
if(!fecha){ cont.innerHTML = ''; return; }

let resultados = [];
clientes.forEach(c=>{
c.historial.filter(h=>h.fechaISO===fecha).forEach(h=>{
resultados.push({ cliente: c, entry: h });
});
});

if(resultados.length === 0){
cont.innerHTML = '<div class="empty-msg">No hay movimientos registrados ese día</div>';
return;
}
// CORRECCIÓN XSS: escapeHtml en nombre
cont.innerHTML = resultados.map(r=>`
<div class="card">
<h3>${r.cliente.codigo} - ${escapeHtml(r.cliente.nombre)}</h3>
<div class="row"><span>${formatearMovimiento(r.entry)}</span></div>
<button class="btn chico outline" onclick="abrirEditarMovimiento('${r.cliente.id}','${r.entry.id}')">✏️ Corregir</button>
</div>
`).join('');
}

// ---------- STOCK DEL CAMION ----------
function mostrarStockCamion(){
cerrarMenus();
document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
document.getElementById('view-stockCamion').classList.add('active');
renderStockCamion();
}

function renderStockCamion(){
const elB20=document.getElementById('stockB20'), elB10=document.getElementById('stockB10'), elDisp=document.getElementById('stockDisp'), elSoda=document.getElementById('stockSoda');
if(elB20) elB20.textContent=stockCamion.b20;
if(elB10) elB10.textContent=stockCamion.b10;
if(elDisp) elDisp.textContent=stockCamion.disp;
if(elSoda) elSoda.textContent=stockCamion.soda||0;
const e20=document.getElementById('stockVaciosB20'), e10=document.getElementById('stockVaciosB10'), es=document.getElementById('stockVaciosSoda'), total=document.getElementById('stockEnvasesVaciosHoy');
if(e20) e20.textContent=stockCamion.vaciosB20||0;
if(e10) e10.textContent=stockCamion.vaciosB10||0;
if(es) es.textContent=stockCamion.vaciosSoda||0;
if(total) total.textContent=(stockCamion.vaciosB20||0)+(stockCamion.vaciosB10||0)+(stockCamion.vaciosSoda||0);
const umbral=5;
if(elB20) elB20.style.color=stockCamion.b20<=umbral?'#c0392b':'';
if(elB10) elB10.style.color=stockCamion.b10<=umbral?'#c0392b':'';
if(elDisp) elDisp.style.color=stockCamion.disp<=umbral?'#c0392b':'';
if(elSoda) elSoda.style.color=(stockCamion.soda||0)<=umbral?'#c0392b':'';
const banner=document.getElementById('stockBajoAlerta');
if(banner){
const bajos=[];
if(stockCamion.b20<=umbral) bajos.push(stockCamion.b20+' bidones 20L');
if(stockCamion.b10<=umbral) bajos.push(stockCamion.b10+' bidones 10L');
if(stockCamion.disp<=umbral) bajos.push(stockCamion.disp+' dispensers');
if((stockCamion.soda||0)<=umbral) bajos.push((stockCamion.soda||0)+' sodas');
if(bajos.length>0&&(stockCamion.b20>0||stockCamion.b10>0||stockCamion.disp>0||(stockCamion.soda||0)>0)){banner.style.display='block';banner.textContent='⚠️ Stock bajo: '+bajos.join(', ');}
else banner.style.display='none';
}
}

function sumarStock(tipo){
const inputId = tipo==='b20' ? 'inputSumarB20' : tipo==='b10' ? 'inputSumarB10' : tipo==='disp' ? 'inputSumarDisp' : 'inputSumarSoda';
const cantidad = parseInt(document.getElementById(inputId).value) || 0;
if(cantidad === 0) return;
stockCamion[tipo] = Math.max(0, (stockCamion[tipo]||0) + cantidad);
document.getElementById(inputId).value = '';
renderStockCamion();
guardarEstado();
syncStock();
}

function cargarStockInicial(){
const b20 = parseInt(document.getElementById('inputStockB20').value);
const b10 = parseInt(document.getElementById('inputStockB10').value);
const disp = parseInt(document.getElementById('inputStockDisp').value);
const soda = parseInt(document.getElementById('inputStockSoda').value);

if(!isNaN(b20)) stockCamion.b20 = b20;
if(!isNaN(b10)) stockCamion.b10 = b10;
if(!isNaN(disp)) stockCamion.disp = disp;
if(!isNaN(soda)) stockCamion.soda = soda;

document.getElementById('inputStockB20').value = '';
document.getElementById('inputStockB10').value = '';
document.getElementById('inputStockDisp').value = '';
document.getElementById('inputStockSoda').value = '';

// El stock inicial marca el comienzo operativo del reparto.
// Creamos el ID del reparto antes de sincronizar ventas/stock.
asegurarRepartoId();
modoTodosClientes = false;

renderStockCamion();
guardarEstado({forzarSync:true});
syncReparto('abierto', fechaContadores || todayISO());
syncStock();

mostrarToast(
'✅ Stock guardado correctamente. Se cargaron bidones, dispensers y sodas.',
'success'
);

// Mostrar automáticamente la ruta correspondiente al día seleccionado.
document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
const vistaRuta = document.getElementById('view-porVisitar');
if(vistaRuta) vistaRuta.classList.add('active');

document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
const tabRuta = document.querySelector('.tab-btn[data-tab="porVisitar"]');
if(tabRuta) tabRuta.classList.add('active');

renderTodo();
}


// ---------- RESPALDO DE DATOS ----------
// ---------- EXPORTAR A EXCEL (CSV, se abre directo en Excel/Sheets) ----------
function exportarExcel(){
cerrarMenus();
const esc=v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const money=v=>Number(v||0);
const rows=[];
clientes.forEach(c=>(c.historial||[]).forEach(h=>{
if(h.texto||!h.tipo) return;
const tipo=h.tipo==='compra'?'Venta':h.tipo==='no_compra'?'No compró':'Pago';
const pago=h.formaPago==='efectivo'?'Efectivo':h.formaPago==='transferencia'?'Transferencia':h.formaPago==='transferencia_pendiente'?(h.transferenciaConfirmada?'Transferencia confirmada':'Transferencia pendiente'):h.formaPago==='entregado'?'Parcial / Fiado':'';
rows.push([h.fechaISO||'',h.hora||'',c.nombre||'',c.codigo||'',c.telefono||'',c.direccion||'',tipo,h.b20||0,h.b10||0,h.disp||0,h.envB20||0,h.envB10||0,money(h.costo),pago,money(h.montoPagado),money(c.saldo)]);
}));
rows.sort((x,y)=>(String(y[0])+' '+String(y[1])).localeCompare(String(x[0])+' '+String(x[1])));
const cell=(v,type='String')=>`<Cell><Data ss:Type="${type}">${esc(v)}</Data></Cell>`;
const row=arr=>`<Row>${arr.map(v=>cell(v,typeof v==='number'?'Number':'String')).join('')}</Row>`;
const header=['Fecha','Hora','Cliente','Código','Teléfono','Dirección','Movimiento','Bidones 20L','Bidones 10-12L','Dispenser','Vacíos 20L','Vacíos 10-12L','Importe','Forma de pago','Monto pagado','Saldo actual'];
const xml=`<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="Header"><Font ss:Bold="1"/></Style></Styles>
<Worksheet ss:Name="Movimientos"><Table>
<Row>${header.map(v=>`<Cell ss:StyleID="Header"><Data ss:Type="String">${esc(v)}</Data></Cell>`).join('')}</Row>
${rows.map(r=>row(r)).join('')}
</Table></Worksheet>
</Workbook>`;
const blob=new Blob([xml],{type:'application/vnd.ms-excel'});
const nombre=`aguatero_v2_movimientos_${diaDeHoy().toLowerCase()}_${todayISO()}.xls`;
if('showSaveFilePicker' in window){
window.showSaveFilePicker({suggestedName:nombre,types:[{description:'Archivo de Excel',accept:{'application/vnd.ms-excel':['.xls']}}]})
.then(async h=>{const w=await h.createWritable();await w.write(blob);await w.close();mostrarToast('✅ Excel guardado correctamente.','success');})
.catch(e=>{if(!e||e.name!=='AbortError') descargarExcelFallback(blob,nombre);});
return;
}
descargarExcelFallback(blob,nombre);
}

function descargarExcelFallback(blob,nombreArchivo){
const url=URL.createObjectURL(blob);
let panel=document.getElementById('excelDownloadFallback'); if(panel) panel.remove();
panel=document.createElement('div'); panel.id='excelDownloadFallback';
panel.style.cssText='position:fixed;left:16px;right:16px;bottom:20px;z-index:99999;background:#fff;padding:16px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.28);text-align:center;border:1px solid #ddd;';
panel.innerHTML='<div style="font-weight:700;margin-bottom:8px;">📊 Excel listo</div><div style="font-size:.85em;margin-bottom:12px;">Si la descarga automática no comenzó, tocá “Descargar Excel”.</div>';
const link=document.createElement('a');link.href=url;link.download=nombreArchivo;link.rel='noopener';link.textContent='⬇️ Descargar Excel';link.className='btn verde';link.style.cssText='display:inline-block;text-decoration:none;padding:10px 18px;';panel.appendChild(link);
const close=document.createElement('button');close.textContent='Cerrar';close.style.cssText='display:block;margin:10px auto 0;border:0;background:none;padding:6px;color:#666;';close.onclick=()=>panel.remove();panel.appendChild(close);
document.body.appendChild(panel);
const auto=document.createElement('a');auto.href=url;auto.download=nombreArchivo;auto.style.display='none';document.body.appendChild(auto);auto.click();auto.remove();
setTimeout(()=>URL.revokeObjectURL(url),120000);
mostrarToast('📊 Excel listo. Si no se descargó automáticamente, tocá “Descargar Excel”.','info');
}

function exportarReporteRepartoHTML(fecha, resumen){
  // Reporte legible para el repartidor. El JSON queda reservado para respaldo técnico.
  const esc = (v)=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fechaLabel = isoAFechaLabel(fecha);
  const nombreDia = diaDeFechaISO(fecha);
  const visitados = clientes.filter(c => Array.from(visitasHoy).includes(c.id));
  const transferenciasPendientes = visitados.reduce((sum,c)=>sum + (c.historial||[]).filter(h=>h.fechaISO===fecha && h.repartoId===repartoActualId && h.formaPago==='transferencia_pendiente' && !h.transferenciaConfirmada).reduce((s,h)=>s + Number(h.costo||0),0),0);
  const clientesHtml = visitados.length ? visitados.map(c=>{
    const movs = (c.historial||[]).filter(h=>h.repartoId===repartoActualId || h.fechaISO===fecha);
    const lineas = movs.map(h=>`<li>${esc(formatearMovimiento(h))}</li>`).join('');
    return `<div class="cliente"><strong>${esc(c.nombre)}</strong><span>${esc(c.direccion||'Sin dirección')}</span><ul>${lineas || '<li>Visita registrada</li>'}</ul><div class="saldo">Saldo actual: $${formatMoney(c.saldo||0)}${Number(c.saldoAFavor||0)>0 ? ' · A favor: $'+formatMoney(c.saldoAFavor) : ''}</div></div>`;
  }).join('') : '<p>No hay clientes visitados registrados.</p>';
  const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cierre de reparto ${esc(fechaLabel)}</title><style>
  body{font-family:Arial,Segoe UI,sans-serif;margin:0;background:#eef3f5;color:#173344} .wrap{max-width:760px;margin:auto;padding:18px} .head{background:#0b3d5c;color:white;border-radius:18px;padding:20px;margin-bottom:14px} h1{margin:0 0 5px;font-size:24px} .muted{opacity:.78} .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px} .card{background:white;border-radius:14px;padding:14px;border:1px solid #dce5e9;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.05)} .dato span{display:block;font-size:12px;color:#687b84;text-transform:uppercase;font-weight:bold}.dato strong{display:block;font-size:20px;margin-top:4px}.venta{color:#1766a2}.cobro{color:#2e8b57}.deuda{color:#c0392b}.orange{color:#c66a16}.linea{display:flex;justify-content:space-between;border-bottom:1px solid #e6ecef;padding:9px 0}.linea:last-child{border:0}.cliente{background:#f8fafb;border:1px solid #e1e8eb;border-radius:12px;padding:12px;margin:8px 0}.cliente>span{display:block;color:#60747e;font-size:13px;margin-top:3px}.cliente ul{margin:8px 0;padding-left:20px;font-size:13px}.saldo{font-weight:bold;margin-top:8px}.footer{text-align:center;color:#73838b;font-size:12px;padding:10px}@media(max-width:520px){.wrap{padding:10px}.grid{grid-template-columns:1fr 1fr}h1{font-size:21px}.dato strong{font-size:18px}}</style></head><body><div class="wrap">
  <div class="head"><h1>🚚 Cierre de reparto</h1><div>${esc(nombreDia)} · ${esc(fechaLabel)}</div><div class="muted">Resumen guardado por Aguateros</div></div>
  <div class="card"><div class="grid">
    <div class="dato"><span>Clientes visitados</span><strong>${resumen.visitas||0}</strong></div>
    <div class="dato"><span>Venta total</span><strong class="venta">$${formatMoney(resumen.venta||0)}</strong></div>
    <div class="dato"><span>Cobrado</span><strong class="cobro">$${formatMoney(resumen.cobrado||0)}</strong></div>
    <div class="dato"><span>Deuda generada</span><strong class="deuda">$${formatMoney(resumen.deuda||0)}</strong></div>
  </div></div>
  <div class="card"><h2>💰 Cobros</h2><div class="linea"><span>Efectivo</span><strong>$${formatMoney(resumen.efectivo||0)}</strong></div><div class="linea"><span>Transferencias recibidas</span><strong>$${formatMoney(resumen.transferencia||0)}</strong></div><div class="linea"><span>Deuda anterior cobrada</span><strong>$${formatMoney(resumen.cobroDeuda||0)}</strong></div><div class="linea"><span>Saldo a favor registrado</span><strong>$${formatMoney(resumen.saldoAFavor||0)}</strong></div><div class="linea"><span>Transferencias pendientes</span><strong class="orange">$${formatMoney(transferenciasPendientes)}</strong></div></div>
  <div class="card"><h2>📦 Movimiento de stock</h2><div class="linea"><span>20 L vendidos</span><strong>${resumen.b20Vendidos||0}</strong></div><div class="linea"><span>10–12 L vendidos</span><strong>${resumen.b10Vendidos||0}</strong></div><div class="linea"><span>Dispensers vendidos</span><strong>${resumen.dispVendidos||0}</strong></div><div class="linea"><span>Sodas vendidas</span><strong>${resumen.sodaVendidas||0}</strong></div><div class="linea"><span>Vacíos recibidos</span><strong>${resumen.envasesRecibidos||0}</strong></div><div class="linea"><span>Sobrante 20 L</span><strong>${resumen.b20Sobrante||0}</strong></div><div class="linea"><span>Sobrante 10–12 L</span><strong>${resumen.b10Sobrante||0}</strong></div><div class="linea"><span>Sobrante dispensers</span><strong>${resumen.dispSobrante||0}</strong></div></div>
  <div class="card"><h2>👥 Clientes visitados</h2>${clientesHtml}</div>
  <div class="footer">Aguateros · Generado automáticamente al cerrar el reparto · ${esc(new Date().toLocaleString('es-AR'))}</div>
</div></body></html>`;
  const blob = new Blob([html], {type:'text/html;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const nombreArchivo = `aguatero_cierre_${nombreDia.toLowerCase()}_${fecha}.html`;

  // Intento automático. En algunos Android/PWA el navegador bloquea esta descarga,
  // por eso también mostramos un botón real para que el repartidor la confirme con un toque.
  const a=document.createElement('a');
  a.href=url;
  a.download=nombreArchivo;
  a.style.display='none';
  document.body.appendChild(a);
  try{ a.click(); }catch(e){}
  a.remove();

  let panel=document.getElementById('cierreDownloadFallback');
  if(panel) panel.remove();
  panel=document.createElement('div');
  panel.id='cierreDownloadFallback';
  panel.style.cssText='position:fixed;left:14px;right:14px;bottom:18px;z-index:100000;background:#10243a;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:16px;box-shadow:0 12px 32px rgba(0,0,0,.35);text-align:center;';
  panel.innerHTML='<div style="font-size:1.05em;font-weight:800;margin-bottom:6px;">📄 Informe de cierre listo</div><div style="font-size:.88em;line-height:1.35;opacity:.88;margin-bottom:12px;">Si no apareció en Descargas, tocá el botón de abajo para guardarlo. También podés abrirlo antes de descargar.</div>';
  const row=document.createElement('div');
  row.style.cssText='display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';
  const abrir=document.createElement('a');
  abrir.href=url;
  abrir.target='_blank';
  abrir.rel='noopener';
  abrir.textContent='👁 Abrir informe';
  abrir.style.cssText='display:inline-block;padding:11px 14px;border-radius:12px;background:#1f3b5b;color:#fff;text-decoration:none;font-weight:700;';
  const descargar=document.createElement('a');
  descargar.href=url;
  descargar.download=nombreArchivo;
  descargar.textContent='⬇️ Descargar informe';
  descargar.style.cssText='display:inline-block;padding:11px 14px;border-radius:12px;background:#2e8b57;color:#fff;text-decoration:none;font-weight:800;';
  const cerrar=document.createElement('button');
  cerrar.type='button';
  cerrar.textContent='Cerrar';
  cerrar.style.cssText='display:block;margin:12px auto 0;border:0;background:transparent;color:#d9e6f2;padding:6px 12px;font-size:.9em;';
  cerrar.onclick=()=>{ panel.remove(); URL.revokeObjectURL(url); };
  row.appendChild(abrir); row.appendChild(descargar); panel.appendChild(row); panel.appendChild(cerrar); document.body.appendChild(panel);
  setTimeout(()=>{ if(document.getElementById('cierreDownloadFallback')===panel){ panel.remove(); URL.revokeObjectURL(url); } },600000);
  mostrarToast('📄 Informe listo. Si no aparece en Descargas, tocá “Descargar informe”.','success');
}

function exportarRespaldo(){
cerrarMenus();
const estado = construirEstadoActual();
const blob = new Blob([JSON.stringify(estado, null, 2)], {type:'application/json'});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
const fecha = todayISO();
const nombreDia = diaDeHoy().toLowerCase();
a.href = url;
a.download = `aguatero_v2_respaldo_${nombreDia}_${fecha}.json`;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);
}

// Envía el respaldo por Drive, Gmail, WhatsApp, etc. usando el selector nativo del celular
function compartirRespaldo(){
cerrarMenus();
const estado = construirEstadoActual();
const contenido = JSON.stringify(estado, null, 2);
const fecha = todayISO();
const nombreArchivo = `aguatero_v2_respaldo_${diaDeHoy().toLowerCase()}_${fecha}.json`;

try{
const archivo = new File([contenido], nombreArchivo, {type:'application/json'});
if(navigator.canShare && navigator.canShare({files:[archivo]})){
navigator.share({
files: [archivo],
title: 'Respaldo LA NORIA',
text: 'Respaldo de datos de LA NORIA - ' + isoAFechaLabel(fecha)
}).catch(()=>{ /* el usuario cerró el selector, no pasa nada */ });
return;
}
}catch(e){ /* seguimos al fallback */ }

mostrarToast('Tu celular no permite compartir el archivo directamente desde acá.\n\nSe va a descargar a la carpeta Descargas — desde ahí lo podés subir a Drive o mandarlo por Gmail a mano.');
exportarRespaldo();
}

function restaurarRespaldo(event){
const archivo = event.target.files[0];
if(!archivo) return;
const lector = new FileReader();
lector.onload = function(e){
try{
const estado = JSON.parse(e.target.result);
aplicarEstadoDesdeObjeto(estado);
guardarEstado();
renderTodo();
mostrarToast('Respaldo restaurado con éxito');
}catch(err){
mostrarToast('No se pudo leer ese archivo de respaldo');
}
};
lector.readAsText(archivo);
event.target.value = '';
}

// ---------- DESHACER ELIMINACION ----------
// Clientes agregados a "fuera de reparto" durante este reparto (no están programados para hoy)
let clientesFueraRutaHoy = new Set();

function tarjetaClienteBusqueda(c, i){
// Versión simplificada para resultados de búsqueda - sin botón de fuera de reparto
const visitado = visitasHoy.has(c.id);
const claseDeuda = tieneDeuda(c) ? 'tiene-deuda' : 'al-dia';
return `
<div class="card ${claseDeuda}">
<div onclick="abrirDetalle('${c.id}')">
<h3>${i!=null ? (i+1)+'. ' : ''}${c.codigo} - ${escapeHtml(c.nombre)} ${visitado ? '<span class="visitado-tag">Visitado</span>' : ''}</h3>
<div class="row"><span>${escapeHtml(c.direccion || 'Sin dirección')}</span></div>
<div class="row"><span>Deuda:</span><span class="${tieneDeuda(c)?'deuda':'saldo-ok'}">${textoSaldo(c)}</span></div>
<div class="row"><span>Envases que debe:</span><span>${c.envasesPendientes}</span></div>
${c.nota ? '<div style="font-size:0.78em; color:#e08a3e; padding:2px 0;">📝 ' + escapeHtml(c.nota) + '</div>' : ''}
</div>
<div class="btn-row">
<button class="btn chico" onclick="abrirStock('${c.id}')">📦 Stock</button>
<button class="btn chico outline" onclick="clienteStockId='${c.id}'; marcarNoCompra()">No compra</button>
</div>
${c.direccion ? `<a class="btn chico outline" style="text-decoration:none; text-align:center; margin-top:4px; display:block;" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.direccion)}" target="_blank" rel="noopener">📍 Cómo llegar</a>` : ''}
</div>
`;
}

// CORRECCIÓN: Venta rápida - ahora pregunta si devuelve el envase
async function ventaRapida(clienteId){
const c = clientes.find(x=>x.id===clienteId);
if(!c) return;
const precios = obtenerPreciosCliente(c, fechaOperativaActual());
if(!precios.b20 || precios.b20 <= 0){
mostrarToast('Este cliente no tiene precio configurado. Tocá el cliente → Editar para asignarle un precio.');
abrirStock(clienteId);
return;
}
// Confirmar y preguntar por envase
const devuelveEnvase = await pedirConfirmacionApp('¿El cliente devuelve el envase vacío?', 'Envase vacío');
const confirmarVenta = await pedirConfirmacionApp('Registrar: 1 bidón 20L a ' + c.nombre + ' - $' + formatMoney(precios.b20) + ' (Efectivo)', 'Confirmar venta');
if(!confirmarVenta) return;

const ahora = new Date();
const entry = {
id: generarId(),
tipo: 'compra',
fechaISO: fechaOperativaActual(),
repartoId: asegurarRepartoId(),
hora: ahora.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'}),
b20: 1, b10: 0, disp: 0, bidones: 1,
envases: devuelveEnvase ? 1 : 0, // CORRECCIÓN
costo: precios.b20,
formaPago: 'efectivo',
montoPagado: precios.b20,
preciosAplicados: precios
};
c.historial.push(entry);
aplicarEfectoMovimiento(c, entry);
syncMovimiento(entry, c.id);
syncCliente(c);
stockCamion.b20 = Math.max(0, stockCamion.b20 - 1);
syncStock();
syncResumenDiario();
registrarVisitaHoy(c.id);
// FIX: No mover al final del dia
if('vibrate' in navigator) navigator.vibrate(50);
renderTodo();
}

function tarjetaCliente(c, i, mostrarBotonesStock){
const visitado = visitasHoy.has(c.id);
const fueraDeRuta = !c.dias.includes(diaSeleccionado);
const yaAgregado = clientesFueraRutaHoy.has(c.id);
const claseDeuda = tieneDeuda(c) ? 'tiene-deuda' : 'al-dia';
return `
<div class="card ${claseDeuda}">
<div onclick="abrirDetalle('${c.id}')">
<h3>${i!=null ? (i+1)+'. ' : ''}${c.codigo} - ${escapeHtml(c.nombre)} ${visitado ? '<span class="visitado-tag">Visitado</span>' : ''}</h3>
<div class="row"><span>${escapeHtml(c.direccion || 'Sin dirección')}</span></div>
<div class="row"><span>Deuda:</span><span class="${tieneDeuda(c)?'deuda':'saldo-ok'}">${textoSaldo(c)}</span></div>
<div class="row"><span>Envases que debe:</span><span>${c.envasesPendientes}</span></div>
${c.nota ? '<div style="font-size:0.78em; color:#e08a3e; padding:2px 0;">📝 ' + escapeHtml(c.nota) + '</div>' : ''}
</div>
${mostrarBotonesStock ? `
<div class="btn-row">
<button class="btn chico" onclick="abrirStock('${c.id}')">📦 Stock</button>
<button class="btn chico outline" onclick="marcarNoCompraRapido('${c.id}')">🚫 No compra</button>
<button class="btn chico verde" style="white-space:nowrap;" onclick="ventaRapida('${c.id}')">⚡ 1x20L$</button>
</div>` : ''}
${c.direccion ? `<a class="btn chico outline" style="text-decoration:none; text-align:center; margin-top:4px; display:block;" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.direccion)}" target="_blank" rel="noopener">📍 Cómo llegar</a>` : ''}
${(fueraDeRuta && !yaAgregado) ? `
<button class="btn chico naranja" style="margin-top:6px;" onclick="agregarAFueraDeReparto('${c.id}')">🚚➕ Agregar a fuera de reparto de hoy</button>` : ''}
</div>
`;
}

// ---------- TARJETA DE CLIENTE AL FINALIZAR EL REPARTO ----------
function tarjetaClienteCierre(c, i){
  const claseDeuda = tieneDeuda(c) ? 'tiene-deuda' : 'al-dia';
  return `
    <div class="card cliente-cierre ${claseDeuda}">
      <div onclick="abrirDetalle('${c.id}')">
        <h3>${i != null ? (i + 1) + '. ' : ''}${c.codigo} - ${escapeHtml(c.nombre)}</h3>
        <div class="row"><span>${escapeHtml(c.direccion || 'Sin dirección')}</span></div>
        <div class="row">
          <span>Deuda:</span>
          <span class="${tieneDeuda(c) ? 'deuda' : 'saldo-ok'}">${textoSaldo(c)}</span>
        </div>
        <div class="row">
          <span>Envases que debe:</span>
          <span>${c.envasesPendientes}</span>
        </div>
      </div>

      <div class="btn-row cliente-cierre-actions">
        <button class="btn chico" onclick="abrirStock('${c.id}')">📦 Stock</button>
        ${c.direccion ? `<a class="btn chico outline cliente-maps-btn"
          href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.direccion)}"
          target="_blank" rel="noopener">📍 Cómo llegar</a>` : ''}
      </div>

      <div class="cliente-cierre-dias">
        📅 ${(c.dias || []).length ? c.dias.join(', ') : 'Sin día asignado'}
      </div>
    </div>
  `;
}

// ---------- RENDER POR VISITAR (los que faltan del reparto de hoy) ----------
function renderPorVisitar(){
  const cont = document.getElementById('listaPorVisitar');

  // Si hay búsqueda activa, mostrar TODOS los clientes que coincidan (sin filtrar por día)
  if(searchTerm){
    document.getElementById('tituloDiaHoy').textContent = '🔍 Resultados de búsqueda';
    const resultados = clientes
      .filter(c=>pasaFiltro(c))
      .sort((a,b)=> a.nombre.localeCompare(b.nombre));

    if(resultados.length===0){
      cont.innerHTML = '<div class="empty-msg">🔍 No se encontraron clientes con "' + searchTerm + '"</div>';
      return;
    }
    cont.innerHTML = resultados.map((c,i)=>{
      const diasTxt = (c.dias||[]).length ? c.dias.join(', ') : 'Sin día asignado';
      const visitadoHoy = visitasHoy.has(c.id);
      const enRutaHoy = c.dias.includes(diaSeleccionado) || clientesFueraRutaHoy.has(c.id);
      let badge;
      if(visitadoHoy){
        badge = '<span style="background:#2e8b57;color:white;font-size:0.7em;padding:2px 6px;border-radius:8px;margin-left:4px;">✅ Atendido hoy</span>';
      } else if(enRutaHoy){
        badge = '<span style="background:#1565c0;color:white;font-size:0.7em;padding:2px 6px;border-radius:8px;margin-left:4px;">📌 En ruta de hoy</span>';
      } else {
        badge = '<span style="background:#e08a3e;color:white;font-size:0.7em;padding:2px 6px;border-radius:8px;margin-left:4px;">Sin atender</span>';
      }
      const botonAgregar = (!enRutaHoy && !visitadoHoy)
        ? `<button class="btn chico naranja" style="margin-top:6px;width:100%;" onclick="agregarParaVisitar('${c.id}')">➕ Agregar para visitar hoy</button>`
        : '';
      const card = tarjetaClienteBusqueda(c, i);
      return card + '<div style="font-size:0.72em;color:#888;padding:0 12px 4px;margin-top:-6px;">📅 ' + diasTxt + badge + '</div>' + botonAgregar;
    }).join('');
    return;
  }

  // --- MODO TODOS LOS CLIENTES / REPARTO CERRADO ---
  if(modoTodosClientes){
    document.getElementById('tituloDiaHoy').textContent =
      '📋 Todos los clientes (' + clientes.length + ')';

    const filtrados = clientes
      .filter(c => pasaFiltro(c))
      .sort((a,b) => a.nombre.localeCompare(b.nombre));

    if(filtrados.length === 0){
      cont.innerHTML =
        '<div class="empty-msg">No hay clientes cargados. Tocá ➕👤 para agregar el primero.</div>';
      return;
    }

    cont.innerHTML = filtrados
      .map((c,i) => tarjetaClienteCierre(c,i))
      .join('');
    return;
  }
  // --- MODO REPARTO (después de cargar reparto del día) ---
  document.getElementById('tituloDiaHoy').textContent = 'Ruta · ' + diaSeleccionado + (diaSeleccionado===diaDeHoy() ? ' (hoy)' : '');
  const filtrados = clientes
    .filter(c=> (c.dias.includes(diaSeleccionado) || clientesFueraRutaHoy.has(c.id)) && !visitasHoy.has(c.id) && pasaFiltro(c))
    .sort((a,b)=>{
      const aEnDia = a.dias.includes(diaSeleccionado) ? 0 : 1;
      const bEnDia = b.dias.includes(diaSeleccionado) ? 0 : 1;
      if(aEnDia !== bEnDia) return aEnDia - bEnDia;
      return (a.ordenPorDia[diaSeleccionado]||0) - (b.ordenPorDia[diaSeleccionado]||0);
    });

  if(filtrados.length===0){
    cont.innerHTML = '<div class="empty-msg">Ya atendiste a todos los clientes de este día 🎉<br><br><button class="btn outline" onclick="volverATodosLosClientes()">← Ver todos los clientes</button></div>';
    return;
  }
  cont.innerHTML = filtrados.map((c,i)=>tarjetaCliente(c,i,true)).join('');
}

// Registra el orden real de atención. El último cliente atendido queda primero.
function registrarVisitaHoy(clienteId){
  visitasHoy.add(clienteId);
  ordenVisitasHoy = ordenVisitasHoy.filter(id => id !== clienteId);
  ordenVisitasHoy.unshift(clienteId);
}

// ---------- RENDER ATENDIDOS (los que ya visitaste del reparto de hoy) ----------
function renderAtendidos(){
  const cont = document.getElementById('listaAtendidos');

  if(modoTodosClientes){
    cont.innerHTML = '<div class="empty-msg">Cargá un reparto del día para ver los atendidos</div>';
    return;
  }

  // Si hay búsqueda activa, mostrar los resultados en "por visitar" (que ya muestra todos)
  if(searchTerm){
    cont.innerHTML = '<div class="empty-msg">Mostrando resultados en "Por visitar"</div>';
    return;
  }

  const mapaOrden = new Map(ordenVisitasHoy.map((id,idx)=>[id,idx]));
  const filtrados = clientes
    .filter(c=>visitasHoy.has(c.id) && pasaFiltro(c))
    .sort((a,b)=> {
      const ia = mapaOrden.has(a.id) ? mapaOrden.get(a.id) : Number.MAX_SAFE_INTEGER;
      const ib = mapaOrden.has(b.id) ? mapaOrden.get(b.id) : Number.MAX_SAFE_INTEGER;
      if(ia !== ib) return ia - ib;
      return (a.ordenPorDia[diaSeleccionado]||0) - (b.ordenPorDia[diaSeleccionado]||0);
    });

  if(filtrados.length===0){
    cont.innerHTML = '<div class="empty-msg">Todavía no atendiste a nadie hoy</div>';
    return;
  }
  cont.innerHTML = filtrados.map((c,i)=>tarjetaCliente(c,i,true)).join('');
}

// ---------- RENDER FUERA DE REPARTO (clientes no programados hoy) ----------
function renderFueraDeReparto(){
  const cont = document.getElementById('listaFueraReparto');

  if(modoTodosClientes){
    cont.innerHTML = '<div class="empty-msg">Cargá un reparto del día para ver esta sección</div>';
    return;
  }

  const termino = (document.getElementById('inputBuscadorFuera').value || '').trim().toLowerCase();
  
  // Primero, mostrar los que ya agregaste (pero todavía sin atender)
  const agregados = clientes.filter(c=>clientesFueraRutaHoy.has(c.id) && !visitasHoy.has(c.id));
  
  // Luego, filtrar disponibles según búsqueda
  let disponibles = clientes.filter(c=>!c.dias.includes(diaSeleccionado) && !clientesFueraRutaHoy.has(c.id) && !visitasHoy.has(c.id));
  if(termino){
    disponibles = disponibles.filter(c=>
      c.nombre.toLowerCase().includes(termino) ||
      c.codigo.toString().includes(termino) ||
      (c.direccion||'').toLowerCase().includes(termino)
    );
  }

  let html = '';
  
  if(agregados.length > 0){
    html += '<div style="margin-bottom:20px;"><div class="card" style="background:var(--verde-pago); color:white;"><strong>✅ Agregados para visitar hoy (' + diaSeleccionado + ')</strong></div>' + 
      agregados.map(c=>tarjetaCliente(c,null,true)).join('') + '</div>';
  }

  if(termino === '' && disponibles.length === 0 && agregados.length === 0){
    html = '<div class="empty-msg">Escribí el nombre, código o dirección de un cliente para buscarlo y agregarlo</div>';
  } else if(disponibles.length === 0 && termino){
    html += '<div class="empty-msg">No encontramos clientes con eso</div>';
  } else if(disponibles.length > 0){
    if(termino) html += '<div class="card" style="background:var(--celeste); color:white;"><strong>Resultados encontrados</strong></div>';
    // CORRECCIÓN XSS: escapeHtml en nombre y dirección
    html += disponibles.map(c=>`
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div onclick="abrirDetalle('${c.id}')" style="flex:1; cursor:pointer;">
            <h3 style="margin:0 0 6px;">${c.codigo} - ${escapeHtml(c.nombre)}</h3>
            <div style="font-size:0.9em;">${escapeHtml(c.direccion || '')}</div>
            <div style="font-size:0.8em; color:#666; margin-top:4px;">Saldo: <strong>$${formatMoney(c.saldo)}</strong></div>
          </div>
          <button class="btn chico naranja" onclick="agregarAFueraDeReparto('${c.id}')">➕ Agregar</button>
        </div>
      </div>
    `).join('');
  }

  cont.innerHTML = html;
}

function agregarAFueraDeReparto(clienteId){
  clientesFueraRutaHoy.add(clienteId);
  // Poner al final del orden del día
  const maxOrden = Math.max(0, ...clientes
    .filter(c => c.dias.includes(diaSeleccionado) || clientesFueraRutaHoy.has(c.id))
    .map(c => c.ordenPorDia[diaSeleccionado] || 0));
  const cli = clientes.find(c => c.id === clienteId);
  if(cli) cli.ordenPorDia[diaSeleccionado] = maxOrden + 1;
  document.getElementById('inputBuscadorFuera').value = '';
  renderFueraDeReparto();
  renderTodo();
}

function agregarParaVisitar(clienteId){
  clientesFueraRutaHoy.add(clienteId);
  // Poner al FINAL de la lista de por visitar (orden más alto)
  const maxOrden = Math.max(0, ...clientes
    .filter(c => c.dias.includes(diaSeleccionado) || clientesFueraRutaHoy.has(c.id))
    .map(c => c.ordenPorDia[diaSeleccionado] || 0));
  const cli = clientes.find(c => c.id === clienteId);
  if(cli) cli.ordenPorDia[diaSeleccionado] = maxOrden + 1;
  guardarEstado();
  // Limpiar búsqueda y volver a la lista normal
  searchTerm = '';
  if(document.getElementById('inputBusqueda')) document.getElementById('inputBusqueda').value = '';
  if(document.getElementById('panelBusqueda')) document.getElementById('panelBusqueda').classList.remove('activo');
  renderTodo();
}

// ---------- ESTADISTICAS ----------
function renderEstadisticas(){
  const totalDia = clientes.filter(c=>c.dias.includes(diaSeleccionado)).length;
  document.getElementById('estVenta').textContent = $(ventaHoy);
  document.getElementById('estEfectivo').textContent = $(efectivoHoy);
  document.getElementById('estTransferencia').textContent = $(transferenciaHoy);
  document.getElementById('estDeuda').textContent = $(deudaGeneradaHoy);
  document.getElementById('estVisitados').textContent = visitasHoy.size + '/' + totalDia;
  document.getElementById('estEntregados').textContent = envasesEntregadosHoy;
  document.getElementById('estRecibidos').textContent = envasesRecibidosHoy;
  document.getElementById('estClientesTotal').textContent = clientes.length;
  document.getElementById('estB20').textContent = b20VendidosHoy;
  document.getElementById('estB10').textContent = b10VendidosHoy;
  document.getElementById('estDisp').textContent = dispVendidosHoy;
  document.getElementById('estSoda').textContent = sodaVendidasHoy;

  const cerrado = resumenesDiarios[todayISO()];
  if(cerrado){
    document.getElementById('estadoCierreHoy').innerHTML =
      `Reparto de hoy cerrado (última vez a las ${cerrado.hora || '-'}). Si seguís vendiendo, podés volver a cerrarlo para actualizar el total.<br><br>` +
      `<strong>Bidones llenos que sobraron:</strong> ${cerrado.b20Sobrante||0} de 20L, ${cerrado.b10Sobrante||0} de 10-12L, ${cerrado.dispSobrante||0} dispensers.`;
  } else {
    document.getElementById('estadoCierreHoy').textContent = 'Todavía no cerraste el reparto de hoy.';
  }
}

// ---------- CERRAR REPARTO DEL DIA ----------
function confirmarCerrarReparto(){
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
  set('cierreVisitas',visitasHoy.size); set('cierreVenta','$'+formatMoney(ventaHoy)); set('cierreCobrado','$'+formatMoney(cobradoHoy)); set('cierreCobroDeuda','$'+formatMoney(cobroDeudaHoy));
  set('cierreEfectivo','$'+formatMoney(efectivoHoy)); set('cierreTransferencia','$'+formatMoney(transferenciaHoy)); set('cierreDeuda','$'+formatMoney(deudaGeneradaHoy));
  set('cierreB20',b20VendidosHoy); set('cierreB10',b10VendidosHoy); set('cierreDisp',dispVendidosHoy); set('cierreSoda',sodaVendidasHoy);
  set('cierreEnvB20',stockCamion.vaciosB20||0); set('cierreEnvB10',stockCamion.vaciosB10||0); set('cierreEnvSoda',stockCamion.vaciosSoda||0);
  set('cierreEnvTotal',(stockCamion.vaciosB20||0)+(stockCamion.vaciosB10||0)+(stockCamion.vaciosSoda||0));
  set('cierreSobrante',stockCamion.b20+' / '+stockCamion.b10+' / '+stockCamion.disp+' / '+(stockCamion.soda||0));
  abrirModal('modalCerrarReparto');
}

function cerrarRepartoDelDia(){
  // El cierre pertenece al reparto abierto, no necesariamente al día calendario actual.
  const fecha=fechaContadores || todayISO();
  const resumenCierre = snapshotResumen(fecha);
  const saldoAFavorGenerado = clientes.reduce((sum,c)=> sum + Number(c.saldoAFavor||0), 0);
  resumenCierre.saldoAFavor = saldoAFavorGenerado;
  resumenCierre.b20Sobrante = stockCamion.b20 || 0;
  resumenCierre.b10Sobrante = stockCamion.b10 || 0;
  resumenCierre.dispSobrante = stockCamion.disp || 0;
  resumenCierre.repartoId = repartoActualId || null;
  resumenesDiarios[fecha]={fecha,venta:ventaHoy,efectivo:efectivoHoy,transferencia:transferenciaHoy,deuda:deudaGeneradaHoy,cobroDeuda:cobroDeudaHoy,
    envasesEntregados:envasesEntregadosHoy,envasesRecibidos:envasesRecibidosHoy,
    envasesRecibidosB20:envasesRecibidosB20Hoy,envasesRecibidosB10:envasesRecibidosB10Hoy,
    b20Vendidos:b20VendidosHoy,b10Vendidos:b10VendidosHoy,dispVendidos:dispVendidosHoy,sodaVendidas:sodaVendidasHoy,
    b20Sobrante:stockCamion.b20,b10Sobrante:stockCamion.b10,dispSobrante:stockCamion.disp,
    visitas:visitasHoy.size,saldoAFavor:saldoAFavorGenerado,hora:new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})};
  guardarEstado({forzarSync:true});
  syncReparto('cerrado', fecha);
  exportarReporteRepartoHTML(fecha, {
    fecha, venta:ventaHoy, cobrado:cobradoHoy, efectivo:efectivoHoy, transferencia:transferenciaHoy,
    deuda:deudaGeneradaHoy, cobroDeuda:cobroDeudaHoy, envasesRecibidos:envasesRecibidosHoy,
    b20Vendidos:b20VendidosHoy, b10Vendidos:b10VendidosHoy, dispVendidos:dispVendidosHoy, sodaVendidas:sodaVendidasHoy,
    b20Sobrante:stockCamion.b20||0, b10Sobrante:stockCamion.b10||0, dispSobrante:stockCamion.disp||0, visitas:visitasHoy.size, saldoAFavor:saldoAFavorGenerado
  });
  ventaHoy=0;cobradoHoy=0;cobroDeudaHoy=0;efectivoHoy=0;transferenciaHoy=0;entregadoHoy=0;deudaGeneradaHoy=0;
  envasesEntregadosHoy=0;envasesRecibidosHoy=0;envasesRecibidosB20Hoy=0;envasesRecibidosB10Hoy=0;
  b20VendidosHoy=0;b10VendidosHoy=0;dispVendidosHoy=0;sodaVendidasHoy=0;visitasHoy=new Set();ordenVisitasHoy=[];clientesFueraRutaHoy=new Set();
  stockCamion={b20:0,b10:0,disp:0,soda:0,vaciosB20:0,vaciosB10:0,vaciosSoda:0};
  fechaContadores=todayISO();fechaInicioTrabajo=fechaContadores;repartoActualId=null;modoTodosClientes=true;searchTerm='';
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const vistaClientes=document.getElementById('view-porVisitar'); if(vistaClientes) vistaClientes.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  const tabClientes=document.querySelector('.tab-btn[data-tab="porVisitar"]'); if(tabClientes) tabClientes.classList.add('active');
  guardarEstado();renderTodo();mostrarToast('✅ Reparto cerrado. Podés revisar todos los clientes antes de cargar el próximo día.','success');
}

// ---------- REPORTE SEMANAL ----------
function mostrarReporteSemanal(){
  cerrarMenus();
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-reporteSemanal').classList.add('active');
  renderReporteSemanal();
}

function renderReporteSemanal(){
  const dias = [];
  for(let i=6; i>=0; i--){
    const d = new Date();
    d.setDate(d.getDate()-i);
    const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    dias.push(iso);
  }

  let totVenta=0, totEfectivo=0, totTransferencia=0, totDeuda=0, totEntregados=0, totRecibidos=0;
  let totB20=0, totB10=0, totDisp=0, totSoda=0;
  const cont = document.getElementById('listaReporteSemanal');
  cont.innerHTML = dias.map(iso=>{
    const r = resumenesDiarios[iso];
    const nombreDia = DIAS[(new Date(iso+'T00:00:00').getDay()+6)%7];
    if(!r){
      return `<div class="card"><h3>${nombreDia} ${isoAFechaLabel(iso)}</h3><div class="empty-msg" style="padding:10px;">Sin cerrar</div></div>`;
    }
    totVenta+=r.venta; totEfectivo+=r.efectivo; totTransferencia+=r.transferencia;
    totDeuda+=r.deuda; totEntregados+=r.envasesEntregados; totRecibidos+=r.envasesRecibidos;
    totB20+=(r.b20Vendidos||0); totB10+=(r.b10Vendidos||0); totDisp+=(r.dispVendidos||0); totSoda+=(r.sodaVendidas||0);
    return `<div class="card">
      <h3>${nombreDia} ${isoAFechaLabel(iso)}</h3>
      <div class="row"><span>Venta:</span><strong>$${$(r.venta)}</strong></div>
      <div class="row"><span>Efectivo:</span><span>$${$(r.efectivo)}</span></div>
      <div class="row"><span>Transferencia:</span><span>$${$(r.transferencia)}</span></div>
      <div class="row"><span>Fiado:</span><span class="deuda">$${$(r.deuda)}</span></div>
      <div class="row"><span>Vendidos 20L / 10-12L / Disp / Soda:</span><span>${r.b20Vendidos||0} / ${r.b10Vendidos||0} / ${r.dispVendidos||0} / ${r.sodaVendidas||0}</span></div>
      <div class="row"><span>Sobraron 20L / 10-12L / Disp:</span><span>${r.b20Sobrante||0} / ${r.b10Sobrante||0} / ${r.dispSobrante||0}</span></div>
      <div class="row"><span>Visitas:</span><span>${r.visitas}</span></div>
    </div>`;
  }).join('');

  document.getElementById('semVenta').textContent = $(totVenta);
  document.getElementById('semEfectivo').textContent = $(totEfectivo);
  document.getElementById('semTransferencia').textContent = $(totTransferencia);
  document.getElementById('semDeuda').textContent = $(totDeuda);
  document.getElementById('semEntregados').textContent = totEntregados;
  document.getElementById('semRecibidos').textContent = totRecibidos;
  document.getElementById('semB20').textContent = totB20;
  document.getElementById('semB10').textContent = totB10;
  document.getElementById('semDisp').textContent = totDisp;
  document.getElementById('semSoda').textContent = totSoda;
}

// ---------- FOOTER DE ESTADISTICAS RAPIDAS ----------
function renderFooter(){
  const totalDia = clientes.filter(c=>c.dias.includes(diaSeleccionado)).length;
  document.getElementById('statVendido').textContent = $(ventaHoy);
  document.getElementById('statCobrado').textContent = $(cobradoHoy);
  document.getElementById('statVisitas').textContent = visitasHoy.size + '/' + totalDia;
}

function renderTodo(){
  verificarResetDiario();
  renderPorVisitar();
  renderAtendidos();
  renderFueraDeReparto();
  renderFooter();
  renderSelectDespuesDe();
  renderSelectorDiaVista();
  actualizarFechaHoyLabel();
  actualizarBannerTransferencias();
  actualizarDeudaTotal();
  if(document.getElementById('view-estadisticas').classList.contains('active')) renderEstadisticas();
  if(document.getElementById('view-stockCamion').classList.contains('active')) renderStockCamion();
  guardarEstado();
}

function actualizarBannerTransferencias(){
  const pendientes = listaTransferenciasPendientes();

  const badge = document.getElementById('badgeTransferencias');
  if(pendientes.length > 0){
    badge.textContent = pendientes.length;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

// ---------- PWA: Service Worker + botón de instalar ----------
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').catch(function(e){
      console.log('No se pudo registrar el Service Worker:', e);
    });
  });
}

let eventoInstalacionDiferido = null;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  eventoInstalacionDiferido = e;
  const boton = document.getElementById('btnInstalarApp');
  if(boton) boton.style.display = 'block';
});

document.getElementById('btnInstalarApp').addEventListener('click', function(){
  const boton = document.getElementById('btnInstalarApp');
  boton.style.display = 'none';
  if(!eventoInstalacionDiferido) return;
  eventoInstalacionDiferido.prompt();
  eventoInstalacionDiferido.userChoice.then(function(){
    eventoInstalacionDiferido = null;
  });
});

window.addEventListener('appinstalled', function(){
  const boton = document.getElementById('btnInstalarApp');
  if(boton) boton.style.display = 'none';
});

// ---------- INICIALIZACION (recién después de iniciar sesión) ----------
// ---------- PULL TO REFRESH ----------
var ptrStartY = 0;
var ptrPulling = false;
var ptrThreshold = 70;

document.addEventListener('touchstart', function(e){
  if(window.scrollY <= 0 && e.touches.length === 1){
    ptrStartY = e.touches[0].clientY;
    ptrPulling = true;
  } else {
    ptrPulling = false;
  }
}, { passive: true });

document.addEventListener('touchmove', function(e){
  if(!ptrPulling) return;
  var pull = e.touches[0].clientY - ptrStartY;
  if(pull > 10 && pull < 150){
    var indicator = document.getElementById('ptrIndicator');
    if(!indicator){
      indicator = document.createElement('div');
      indicator.id = 'ptrIndicator';
      indicator.style.cssText = 'position:fixed; top:0; left:50%; transform:translateX(-50%); z-index:9999; padding:8px 16px; font-size:0.85em; color:#999; transition:opacity 0.2s; pointer-events:none;';
      document.body.appendChild(indicator);
    }
    indicator.style.display = 'block';
    indicator.textContent = pull > ptrThreshold ? '\ud83d\udd04 Soltar para actualizar' : 'Desliza para actualizar...';
    indicator.style.opacity = Math.min(pull / ptrThreshold, 1);
  }
}, { passive: true });

document.addEventListener('touchend', function(e){
  var indicator = document.getElementById('ptrIndicator');
  if(ptrPulling && indicator && indicator.style.display === 'block'){
    var pull = (e.changedTouches[0] || {}).clientY - ptrStartY;
    if(pull > ptrThreshold){
      indicator.textContent = 'Actualizando...';
      renderTodo();
      if('vibrate' in navigator) navigator.vibrate(30);
      setTimeout(function(){
        indicator.style.display = 'none';
      }, 500);
    } else {
      indicator.style.display = 'none';
    }
  }
  ptrPulling = false;
}, { passive: true });

// FIX: si la app se abre en una fecha distinta a la última vez que se guardó
// el estado, la vista se reacomoda a HOY (para no quedarte mirando la ruta
// de otro día por accidente) y, si el reparto anterior quedó sin cerrar,
// se avisa para evitar que las ventas de dos días se mezclen en los totales.
function verificarCambioDeDiaAlAbrir(){
  const hoy = todayISO();
  const hayStockOperativo = !!(stockCamion && (
    stockCamion.b20 || stockCamion.b10 || stockCamion.disp || stockCamion.soda ||
    stockCamion.vaciosB20 || stockCamion.vaciosB10 || stockCamion.vaciosSoda
  ));
  // Un reparto abierto existe aunque todavía no haya ventas ni visitas.
  // El ID del reparto es la fuente de verdad; no usamos solamente "hoy".
  const hayRepartoAbierto = !!repartoActualId || !!fechaContadores && (
    ventaHoy > 0 || cobradoHoy > 0 || deudaGeneradaHoy > 0 ||
    (visitasHoy && visitasHoy.size > 0) || hayStockOperativo
  );

  if(fechaContadores && fechaContadores !== hoy && hayRepartoAbierto){
    setTimeout(function(){
      mostrarAvisoRepartoSinCerrar(fechaContadores);
    }, 600);
  }

  // Si existe un reparto abierto, conservar exactamente su día y volver
  // directamente a la ruta, sin obligar al repartidor a tocar "Cargar reparto".
  if(hayRepartoAbierto){
    modoTodosClientes = false;
  }else{
    diaSeleccionado = diaDeHoy();
    modoTodosClientes = true;
  }
  guardarEstado();
}


function mostrarAvisoRepartoSinCerrar(fecha){
  var modal = document.getElementById('modalAvisoRepartoSinCerrar');
  var fechaEl = document.getElementById('avisoRepartoFecha');
  if(fechaEl) fechaEl.textContent = isoAFechaLabel(fecha);
  if(modal) abrirModal('modalAvisoRepartoSinCerrar');
  else mostrarToast('Hay un reparto anterior sin cerrar: ' + isoAFechaLabel(fecha), 'error');
}

function cerrarAvisoRepartoSinCerrar(){
  cerrarModal('modalAvisoRepartoSinCerrar');
}

function inicializarAppLuegoDeLogin(){
  cargarEstado();
  verificarCambioDeDiaAlAbrir();
  renderFiltroTabs();
  // FIX: ya NO forzamos "todos los clientes" al abrir la app. Si el usuario
  // tenia un reparto del dia cargado, se mantiene igual aunque cierre y
  // vuelva a abrir la app - se sale de ese modo recien cuando cierra el
  // reparto del dia (ver cerrarRepartoDelDia).
  renderTodo();

  // Guardado extra de seguridad: por si el celular cierra la app de golpe
  // (al mandar WhatsApp, al apretar Atrás, al minimizar, etc.)
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden') guardarEstado();
  });
  window.addEventListener('pagehide', guardarEstado);
  window.addEventListener('beforeunload', guardarEstado);
  setInterval(guardarEstado, 10000); // respaldo silencioso cada 10 segundos
}
// ---------- BOT DE AYUDA ----------
function toggleHelpBot(){
  var panel = document.getElementById('helpPanel');
  if(!panel) return;
  panel.classList.toggle('active');
  if(panel.classList.contains('active')){
    setTimeout(function(){ var inp = document.getElementById('helpInput'); if(inp) inp.focus(); }, 100);
  }
}

function enviarPreguntaHelp(){
  var input = document.getElementById('helpInput');
  var messages = document.getElementById('helpMessages');
  if(!input || !messages) return;
  var preg = input.value.trim();
  if(!preg) return;

  var divUser = document.createElement('div');
  divUser.className = 'help-message user';
  divUser.textContent = preg;
  messages.appendChild(divUser);
  input.value = '';

  var respuesta = responderHelpBot(preg);
  setTimeout(function(){
    var divBot = document.createElement('div');
    divBot.className = 'help-message bot';
    divBot.textContent = respuesta;
    messages.appendChild(divBot);
    messages.scrollTop = messages.scrollHeight;
    if('vibrate' in navigator) navigator.vibrate(30);
  }, 400);
}

function responderHelpBot(pregunta){
  var p = pregunta.toLowerCase();

  if(p.match(/hola|buenas|hey|qu\u00e9 tal/)) return '\u00a1Hola! \ud83d\udc4b \u00bfEn qu\u00e9 te puedo ayudar? Preguntame sobre clientes, ventas, stock, deudas, rutas o cualquier problema.';
  if(p.match(/agregar.*cliente|nuevo.*cliente|dar de alta|registrar.*cliente/)) return 'Para agregar un cliente: toc\u00e1 el bot\u00f3n \u2795\ud83d\udc64 arriba a la derecha. Complet\u00e1 nombre, tel\u00e9fono, direcci\u00f3n, precio y los d\u00edas de reparto.';
  if(p.match(/venta|cargar|registrar.*bid\u00f3n|vender/)) return 'Para registrar una venta: toc\u00e1 el cliente \u2192 "\ud83d\udce6 Stock" \u2192 ingres\u00e1 cantidad con + y - \u2192 eleg\u00ed pago (Efectivo/Transferencia) \u2192 "Confirmar". Tambi\u00e9n pod\u00e9s usar \u26a1 para venta r\u00e1pida de 1 bid\u00f3n 20L en efectivo.';
  if(p.match(/stock|camion|cami\u00f3n|cuantos|cu\u00e1ntos.*bid\u00f3n/)) return 'Para ver o cargar el stock: men\u00fa \u2630 \u2192 "Stock del cami\u00f3n". Ah\u00ed ves cu\u00e1ntos bidones te quedan y carg\u00e1s el stock inicial antes de salir.';
  if(p.match(/deuda|saldo|debe|cobrar/)) return 'El saldo se actualiza solo al registrar ventas y pagos. Los clientes con deuda aparecen con borde rojo. Toc\u00e1 el cliente para ver el detalle e historial.';
  if(p.match(/ruta|orden|d\u00eda|reparto|lunes|martes|mi\u00e9rcoles|jueves|viernes|s\u00e1bado|domingo/)) return 'Para cambiar el d\u00eda de reparto: toc\u00e1 el cliente \u2192 Editar \u2192 d\u00edas asignados (Lun a Dom). Para ver clientes de un d\u00eda espec\u00edfico, us\u00e1 \ud83d\udcc5 arriba.';
  if(p.match(/no compra|no.*visit|saltar|pasar/)) return 'Si un cliente no compra en su d\u00eda, toc\u00e1 "No compra" en su tarjeta. Se marca como visitado sin registrar venta.';
  if(p.match(/transferencia|transfer.*pend|confirmar.*transfer/)) return 'Las transferencias pendientes aparecen con el bot\u00f3n \ud83d\udd50 arriba. Tocalo para verlas y confirmarlas cuando te llegue el dinero.';
  if(p.match(/resumen|caja|total|recaud|ganancia|cuanto|cu\u00e1nto.*vend\u00ed/)) return 'Para ver el resumen del d\u00eda: men\u00fa \u2630 \u2192 "Resumen del d\u00eda". Muestra total vendido, efectivo, transferencias, deudas y bidones.';
  if(p.match(/exportar|excel|backup|respaldo|descargar.*datos/)) return 'Para exportar datos: men\u00fa \u2630 \u2192 "Exportar a Excel" o "Respaldo JSON". Te descarga un archivo con todos tus datos.';
  if(p.match(/borrar.*cliente|eliminar.*cliente|sacar.*cliente/)) return 'Para borrar un cliente: abr\u00ed su tarjeta \u2192 "Eliminar". Hay un bot\u00f3n "Deshacer" abajo por si te equivocaste. El historial se restaura autom\u00e1ticamente.';
  if(p.match(/precio|cambiar.*precio|aumentar|subir.*precio/)) return 'Para cambiar el precio: toc\u00e1 el cliente \u2192 Editar. Pod\u00e9s cambiar precio de bid\u00f3n 20L, 10L y dispenser. (Pronto: aumento masivo de precios).';
  if(p.match(/internet|sin conexion|sin conexi\u00f3n|offline|no.*se\u00f1al|sin.*se\u00f1al/)) return '\u00a1Tranquilo! Aguatero funciona sin internet. Las ventas se guardan en tu celular. Cuando recuperes se\u00f1al, se sincronizan solas con la nube. \ud83d\udcf6';
  if(p.match(/whatsapp|comprobante|boleta|enviar.*comprobante/)) return 'Para enviar un comprobante por WhatsApp: abr\u00ed el cliente \u2192 historial \u2192 bot\u00f3n \ud83e\udd9e. Ah\u00ed ves un bot\u00f3n para enviarlo directo por WhatsApp al cliente.';
  if(p.match(/mapa|gps|direccion|direcci\u00f3n|como llegar|c\u00f3mo llegar|ubicacion|ubicaci\u00f3n/)) return 'Cada cliente con direcci\u00f3n tiene un bot\u00f3n "\ud83d\udccd C\u00f3mo llegar" que abre Google Maps directamente. Toc\u00e1 el cliente y buscalo en su tarjeta.';
  if(p.match(/deshacer|anular|eliminar.*venta|borrar.*movimiento/)) return 'Para anular una venta: toc\u00e1 el cliente \u2192 historial \u2192 "Editar" en el movimiento \u2192 "Anular". Se revierten saldos, stock y envases.';
  if(p.match(/modo oscuro|tema|noche|claro|oscuro/)) return 'Para activar el modo oscuro: men\u00fa \u2630 \u2192 "Modo oscuro".';
  if(p.match(/suscripcion|suscripci\u00f3n|pago|membresia|membres\u00eda|vencio|venci\u00f3|cobro/)) return 'La suscripci\u00f3n de Aguatero es mensual. Si venci\u00f3, toc\u00e1 el bot\u00f3n de pago en pantalla. Tus datos no se eliminan por falta de pago.';
  if(p.match(/contrase\u00f1a|olvide|olvid\u00e9|no.*puedo.*entrar|login|sesion|sesi\u00f3n/)) return 'Si olvidaste tu contrase\u00f1a: pantalla de inicio \u2192 "\u00bfOlvidaste tu contrase\u00f1a?" \u2192 te enviamos un email para cambiarla.';
  if(p.match(/error|problema|no funciona|falla|bug/)) return 'Lo siento \ud83d\ude4f Prob\u00e1 cerrar y abrir la app. Si persiste, contame qu\u00e9 estabas haciendo cuando fall\u00f3 y reportalo a quien te dio acceso.';
  if(p.match(/gracias|genial|buenisimo|buen\u00edsimo|perfecto|excelente/)) return '\u00a1De nada! \ud83d\ude04 Preguntame cuando quieras.';
  if(p.match(/que.*podes|qu\u00e9.*pod\u00e9s|que.*sabes|qu\u00e9.*sab\u00e9s|ayuda|opciones/)) return 'Puedo ayudarte con: agregar clientes, ventas, stock, deudas, rutas, transferencias, exportar datos, modo oscuro, WhatsApp, GPS y m\u00e1s. \u00bfQu\u00e9 necesit\u00e1s?';

  return 'Mmm, no estoy seguro de eso \ud83e\uddd0 Pod\u00e9s preguntarme sobre: clientes, ventas, stock, deudas, rutas, transferencias, exportar datos o cualquier problema que tengas.';
}
// ---------- PANEL ADMIN - AUTORIZACION POR ROLE EN SUPABASE/RLS ----------
// El email de soporte se configura arriba desde AGUATERO_CONFIG.
function esAdmin(){ return !!(usuarioActual && usuarioEsAdmin); }
function mostrarBotonAdminSiCorresponde(){
  if(!esAdmin()) return;
  if(document.getElementById('btnAdminPanel')) return;
  const menu = document.getElementById('menuDropdown');
  if(!menu) return;
  const btn = document.createElement('button');
  btn.id = 'btnAdminPanel';
  btn.className = 'menu-item';
  btn.style.background = '#ff8f00';
  btn.style.color = '#000';
  btn.style.fontWeight = '900';
  btn.style.border = '2px solid #000';
  btn.textContent = '👑 ADMIN - VER USO DE CLIENTES';
  btn.onclick = () => { cerrarMenus(); mostrarPanelAdmin(); };
  menu.insertBefore(btn, menu.firstChild);
}
async function mostrarPanelAdmin(){
  let modal = document.getElementById('modalAdmin');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'modalAdmin';
    modal.className = 'modal-bg active';
    modal.innerHTML = `<div class="modal-card" style="max-width:95%;width:600px;max-height:90vh;overflow-y:auto;"><h2>👑 PANEL ADMIN</h2><div id="adminContenido">Cargando...</div><div class="btn-row" style="margin-top:12px;"><button class="btn outline" onclick="document.getElementById('modalAdmin').classList.remove('active')">Cerrar</button><button class="btn" onclick="cargarDatosAdmin()">Actualizar</button></div></div>`;
    document.body.appendChild(modal);
  } else modal.classList.add('active');
  cargarDatosAdmin();
}
async function cargarDatosAdmin(){
  const cont = document.getElementById('adminContenido');
  if(!esAdmin()){ cont.innerHTML='Acceso denegado.'; return; }
  cont.innerHTML = 'Cargando...';
  try{
    const { data: movs, error } = await sb.from('movimientos').select('*').order('fecha_iso',{ascending:false}).limit(200);
    if(error){ cont.innerHTML = `RLS bloquea ver otros usuarios.<br>Error: ${error.message}<br><br>Andá a Supabase > Table Editor > movimientos para verlos.`; return; }
    cont.innerHTML = movs.map(m=>`<div class="card" style="font-size:0.8em;padding:6px;">${m.fecha_iso} ${m.hora||''} - ${m.tipo} $${m.costo||0} - user:${m.user_id.slice(0,6)}</div>`).join('') || 'Sin movimientos';
  }catch(e){ cont.innerHTML='Error:'+e.message; }
}
const __onLoginOkOriginal = onLoginExitoso;
onLoginExitoso = function(session){ __onLoginOkOriginal(session); setTimeout(mostrarBotonAdminSiCorresponde,700); };
const __initOriginal = inicializarAppLuegoDeLogin;
inicializarAppLuegoDeLogin = function(){ __initOriginal(); setTimeout(mostrarBotonAdminSiCorresponde,900); };
