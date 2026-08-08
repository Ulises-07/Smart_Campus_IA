/* ============================================================
   Reloj tipo "flip clock". Muestra día (nombre + número), hora
   (HH:MM:SS con volteo) y la fecha completa. Se actualiza cada segundo.
   ============================================================ */

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Crea una "carta" flip y devuelve una función para actualizar su valor.
function crearCarta(contenedor, clase = '') {
  const carta = document.createElement('div');
  carta.className = `flip-carta ${clase}`.trim();
  const cara = document.createElement('div');
  cara.className = 'flip-cara';
  carta.appendChild(cara);
  contenedor.appendChild(carta);

  let anterior = null;
  return (valor) => {
    if (valor === anterior) return;      // solo anima si cambió
    anterior = valor;
    cara.textContent = valor;
    carta.classList.remove('cambiando');
    void carta.offsetWidth;              // reinicia la animación
    carta.classList.add('cambiando');
  };
}

function separador(contenedor, simbolo = ':') {
  const s = document.createElement('div');
  s.className = 'flip-dosp';
  s.textContent = simbolo;
  contenedor.appendChild(s);
  return s;
}

/**
 * Monta el reloj dentro del elemento con el id dado.
 * Devuelve una función para detenerlo (por si se necesita).
 */
export function montarReloj(idContenedor) {
  const cont = document.getElementById(idContenedor);
  if (!cont) return () => {};

  cont.classList.add('reloj-flip');
  cont.innerHTML = `
    <div class="reloj-seccion">
      <span class="reloj-rotulo">Día</span>
      <div class="reloj-fila" id="reloj-dia"></div>
    </div>
    <div class="reloj-div"></div>
    <div class="reloj-seccion">
      <span class="reloj-rotulo">Hora</span>
      <div class="reloj-fila" id="reloj-hora"></div>
    </div>`;

  // Cartas del día: nombre + número.
  const filaDia = cont.querySelector('#reloj-dia');
  const setNombreDia = crearCarta(filaDia, 'ancha');
  const setNumDia = crearCarta(filaDia, 'media');

  // Cartas de la hora: HH : MM : SS.
  const filaHora = cont.querySelector('#reloj-hora');
  const setH = crearCarta(filaHora);
  separador(filaHora);
  const setM = crearCarta(filaHora);
  separador(filaHora);
  const setS = crearCarta(filaHora);

  const dosDig = (n) => String(n).padStart(2, '0');

  function tick() {
    const ahora = new Date();
    setNombreDia(DIAS[ahora.getDay()]);
    setNumDia(dosDig(ahora.getDate()));
    setH(dosDig(ahora.getHours()));
    setM(dosDig(ahora.getMinutes()));
    setS(dosDig(ahora.getSeconds()));
  }

  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}
