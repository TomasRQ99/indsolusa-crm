// Glosario de SOLU. One entry per term people meet on screen: what it means in general and, where the
// same word means something more specific on a given screen, what it means THERE. The bubbles on every
// screen (components/shell/GlossaryLayer.tsx) and the page /glosario both read from this list, so a term
// is explained with the same words everywhere. Pure data: no database, no AI.
//
// To add a term: add an entry with the exact words as they appear on screen in `forms` (singular and
// plural, Spanish and English). `cs` = match the exact capitals (for short codes such as OC or TRM).
// `only` = the word is too common elsewhere, so it is a term only on those screens.

export type Txt = { es: string; en: string };
export type GlossCtx = {
  /** screens where this meaning applies: path prefixes ("/deals") or a tab ("tab=quote") */
  at?: string[];
  /** or: the term sits inside this element (CSS selector) */
  sel?: string;
  /** the name of that place, shown in the glossary page */
  where: Txt;
} & Txt;
export type GlossArea = "general" | "mercado" | "comercial" | "operaciones" | "administracion" | "equipo" | "gerencia";
export type GlossTerm = { id: string; area: GlossArea; name: Txt; forms: string[]; cs?: boolean; only?: string[]; def: Txt; ctx?: GlossCtx[] };

export const GLOSS_AREAS: Record<GlossArea, Txt> = {
  general: { es: "En todo SOLU", en: "Across SOLU" },
  mercado: { es: "Mercado", en: "Market" },
  comercial: { es: "Comercial", en: "Commercial" },
  operaciones: { es: "Operaciones", en: "Operations" },
  administracion: { es: "Administración", en: "Administration" },
  equipo: { es: "Equipo", en: "Team" },
  gerencia: { es: "Gerencia", en: "Management" },
};

export const GLOSSARY: GlossTerm[] = [
  // ── En todo SOLU ──
  {
    id: "necesidad", area: "general", name: { es: "Necesidad", en: "Necessity" },
    forms: ["Necesidad", "Necesidades", "Necessity", "Necessities"],
    def: { es: "El caso completo de un cliente: lo que necesita, la cotización, la compra al proveedor, la entrega, la factura, el cobro y el resultado que logró. Todo lo de ese pedido vive en un solo lugar y tiene un código (J-año-mes-número).", en: "A customer's whole case: what they need, the quote, the supplier purchase, the delivery, the invoice, the collection and the result they achieved. Everything about that order lives in one place and has a code (J-year-month-number)." },
    ctx: [
      { sel: ".kanban .column > h2", where: { es: "Título de la primera columna del tablero", en: "Title of the board's first column" }, es: "Aquí es la primera etapa: ya sabemos qué necesita el cliente, pero aún no hay proveedor ni precio.", en: "Here it is the first stage: we know what the customer needs, but there is no supplier or price yet." },
      { at: ["/deals"], sel: "[role=tab], .tabs a", where: { es: "Pestaña dentro de una Necesidad", en: "Tab inside a Necessity" }, es: "Aquí es la pestaña donde se escribe qué pidió el cliente y qué resultado busca.", en: "Here it is the tab where you write what the customer asked for and the result they want." },
      { at: ["/mercado"], where: { es: "Mercado", en: "Market" }, es: "En Mercado, una señal se vuelve Necesidad cuando el cliente cuenta una dificultad concreta. Al confirmarla, pasa a Comercial con todo lo que Mercado ya sabía.", en: "In Market, a signal becomes a Necessity when the customer describes a concrete difficulty. Once confirmed it moves to Commercial with everything Market already knew." },
      { at: ["/compras", "/operaciones", "/logistica"], where: { es: "Compras y Operaciones", en: "Purchasing and Operations" }, es: "Aquí dice para qué cliente y para qué pedido es esta compra, envío o entrega. Lo que no está asignado a una Necesidad es inventario.", en: "Here it tells which customer and order this purchase, shipment or delivery is for. What is not assigned to a Necessity is stock." },
      { at: ["/administracion", "/gerencia"], where: { es: "Administración y Gerencia", en: "Administration and Management" }, es: "Aquí es la unidad con la que se mide el dinero: cada factura, costo, comisión y Eságara pertenece a una Necesidad.", en: "Here it is the unit money is measured by: every invoice, cost, commission and Eságara belongs to a Necessity." },
    ],
  },
  {
    id: "esagara", area: "general", name: { es: "Eságara", en: "Eságara" }, forms: ["Eságara", "eságara"],
    def: { es: "Palabra propia de Industry Solutions para lo que deja una venta: precio de venta menos sus costos directos (proveedor, flete y otros). Se muestra en dólares y en porcentaje. Nunca aparece en documentos para el cliente.", en: "Industry Solutions' own word for what a sale leaves: sale price minus its direct costs (supplier, freight and others). Shown in dollars and as a percentage. It never appears on customer documents." },
    ctx: [
      { at: ["/cotizaciones", "tab=quote"], where: { es: "Cotización", en: "Quote" }, es: "Aquí es la Eságara que esta cotización dejaría con los costos que tiene escritos hoy. Cambia cada vez que cambias un precio o un costo.", en: "Here it is the Eságara this quote would leave with the costs written today. It changes whenever you change a price or a cost." },
      { at: ["/gerencia/comisiones", "/gerencia/liquidacion"], where: { es: "Comisiones", en: "Commissions" }, es: "Aquí es la base sobre la que se calcula la comisión de cada persona.", en: "Here it is the base each person's commission is calculated on." },
      { at: ["/comercial/metas", "/informes"], where: { es: "Metas e informes", en: "Goals and reports" }, es: "Aquí es la Eságara protegida de las cotizaciones que el cliente aceptó en el periodo.", en: "Here it is the protected Eságara of the quotes the customer accepted in the period." },
    ],
  },
  {
    id: "esagara-protegida", area: "general", name: { es: "Eságara protegida", en: "Protected Eságara" },
    forms: ["Eságara protegida", "eságara protegida", "protected Eságara", "Protected Eságara"],
    def: { es: "La Eságara que quedó fijada el día en que el cliente aceptó la cotización. Es el punto de comparación: todo lo que pase después se mide contra ella.", en: "The Eságara fixed on the day the customer accepted the quote. It is the reference point: everything that happens later is measured against it." },
  },
  {
    id: "esagara-real", area: "administracion", name: { es: "Eságara real", en: "Real Eságara" },
    forms: ["Eságara real", "Eságara esperada", "Eságara final", "Real Eságara", "expected Eságara", "final Eságara"],
    def: { es: "Lo que la Necesidad deja de verdad con los costos reales. «Esperada» es el cálculo de hoy, mientras aún pueden llegar costos; «final» es la cifra cuando la economía se cierra. Se compara con la protegida y se explica la diferencia.", en: "What the Necessity really leaves with real costs. \"Expected\" is today's figure, while costs can still arrive; \"final\" is the figure once the economics are closed. It is compared with the protected one and the difference is explained." },
  },
  {
    id: "siguiente-movimiento", area: "general", name: { es: "Siguiente movimiento", en: "Next movement" },
    forms: ["Siguiente movimiento", "siguiente movimiento", "siguientes movimientos", "próximo movimiento", "Próximo movimiento", "Next movement", "next movement", "next move"],
    def: { es: "Lo próximo que alguien de nosotros va a hacer para que el caso avance, con fecha. Todo caso activo debe tener uno, o una espera con control.", en: "The next thing one of us will do to move the case forward, with a date. Every active case must have one, or a wait with control." },
    ctx: [{ at: ["/mi-dia", "/mi-plan"], where: { es: "Mi Día", en: "My Day" }, es: "Aquí son los movimientos tuyos que tocan hoy. Al marcar uno como hecho, SOLU te pregunta cuál sigue.", en: "Here they are your movements due today. When you mark one done, SOLU asks what comes next." }],
  },
  {
    id: "espera-control", area: "general", name: { es: "Espera con control", en: "Wait with control" },
    forms: ["Espera con control", "espera con control", "esperas con control", "Esperando con control", "Waiting with control", "waiting with control", "Wait with control"],
    def: { es: "El caso depende de otro (cliente, proveedor, transportador), pero sabemos a quién esperamos, qué esperamos y hasta cuándo. Cuando pasa esa fecha, vuelve a ser un movimiento nuestro.", en: "The case depends on someone else (customer, supplier, carrier), but we know who we wait for, what for and until when. Once that date passes it becomes our move again." },
    ctx: [{ at: ["/administracion/cobrar"], where: { es: "Cuentas por cobrar", en: "Receivables" }, es: "Aquí significa que el cliente dio una fecha de pago y todavía no ha pasado.", en: "Here it means the customer gave a payment date and it has not passed yet." }],
  },
  {
    id: "resultado-deseado", area: "general", name: { es: "Resultado deseado", en: "Desired result" },
    forms: ["Resultado deseado", "resultado deseado", "resultado que busca el cliente", "Desired result", "desired result"],
    def: { es: "Lo que el cliente quiere lograr con el pedido, en sus palabras (por ejemplo: «que la línea 3 no pare en diciembre»). No es el producto: es para qué lo necesita.", en: "What the customer wants to achieve with the order, in their words (for example: \"line 3 must not stop in December\"). It is not the product: it is what they need it for." },
  },
  {
    id: "resultado-logrado", area: "general", name: { es: "Resultado logrado", en: "Result achieved" },
    forms: ["Resultado logrado", "resultado logrado", "resultado confirmado", "Resultado del cliente", "Result achieved", "result achieved"],
    def: { es: "El cliente confirmó que consiguió lo que buscaba. Entregar no es lo mismo: una Necesidad puede estar entregada y aún no tener resultado.", en: "The customer confirmed they got what they wanted. Delivering is not the same: a Necessity can be delivered and still have no result." },
  },
  {
    id: "promesa", area: "general", name: { es: "Promesa", en: "Promise" },
    forms: ["Promesa", "promesa", "promesas", "Fecha prometida", "fecha prometida", "Promise", "promised date", "Promised date"],
    def: { es: "La fecha de entrega que le dimos al cliente. Queda protegida al aceptar su orden de compra; si cambia, se registra por qué.", en: "The delivery date we gave the customer. It is protected when their purchase order is accepted; if it changes, the reason is recorded." },
    ctx: [{ at: ["/operaciones", "/logistica", "/compras"], where: { es: "Operaciones y Compras", en: "Operations and Purchasing" }, es: "Aquí es la fecha contra la que se mide cada compra y cada envío: si el proveedor o el transportador se atrasan, la promesa queda en riesgo.", en: "Here it is the date each purchase and shipment is measured against: if the supplier or carrier is late, the promise is at risk." }],
  },
  {
    id: "holgura", area: "general", name: { es: "Holgura", en: "Slack" }, forms: ["Holgura", "holgura", "Slack"], cs: true,
    def: { es: "Los días que sobran entre la fecha en que esperamos tener la mercancía y la fecha prometida al cliente. Si llega a cero, cualquier atraso incumple la promesa.", en: "The days left between when we expect to have the goods and the date promised to the customer. At zero, any delay breaks the promise." },
  },
  {
    id: "recovery", area: "general", name: { es: "Recovery", en: "Recovery" }, forms: ["Recovery"], cs: true,
    def: { es: "El plan de recuperación cuando el cliente no logró su resultado o una promesa se incumplió: qué cambió, qué impacto tiene, las opciones y la que se eligió, con fecha. Se cierra como exitosa solo cuando el cliente confirma.", en: "The recovery plan when the customer did not achieve their result or a promise was broken: what changed, the impact, the options and the one chosen, with a date. It closes as successful only when the customer confirms." },
  },
  {
    id: "compromiso-incumplido", area: "general", name: { es: "Compromiso incumplido", en: "Commitment missed" },
    forms: ["Compromiso incumplido", "compromisos incumplidos", "Commitment missed"],
    def: { es: "Alguien prometió algo con fecha y la fecha pasó sin que ocurriera. Es la señal más seria de SOLU.", en: "Someone promised something by a date and the date passed without it happening. It is SOLU's most serious signal." },
    ctx: [{ at: ["/administracion/cobrar"], where: { es: "Cuentas por cobrar", en: "Receivables" }, es: "Aquí significa que el cliente dijo que pagaba en una fecha y no pagó.", en: "Here it means the customer said they would pay on a date and did not." }],
  },
  {
    id: "inferencia", area: "general", name: { es: "Inferencia", en: "Inference" }, forms: ["Inferencia", "inferencia", "inferencias", "Inference", "inference", "inferences"],
    def: { es: "Algo que SOLU dedujo de un texto o de los datos, no un hecho que alguien confirmó. Siempre dice de dónde lo sacó y espera que una persona lo confirme o lo descarte.", en: "Something SOLU deduced from a text or the data, not a fact someone confirmed. It always says where it came from and waits for a person to confirm or discard it." },
  },
  {
    id: "oc", area: "general", name: { es: "OC (orden de compra del cliente)", en: "PO (customer purchase order)" },
    forms: ["OC del cliente", "OC aceptada", "OC aceptadas", "OC", "PO del cliente", "Customer PO", "customer PO", "PO accepted", "PO aceptada"], cs: true,
    def: { es: "El documento con el que el cliente nos compra. Cuando la aceptamos, la venta es firme: se protegen la promesa y la Eságara, y Operaciones puede empezar.", en: "The document the customer buys from us with. Once we accept it the sale is firm: the promise and the Eságara are protected and Operations can start." },
    ctx: [
      { sel: ".kanban .column > h2", where: { es: "Columna del tablero", en: "Board column" }, es: "Aquí es la etapa de las Necesidades con venta firme: lo que sigue es comprar, entregar, facturar y cobrar.", en: "Here it is the stage of Necessities with a firm sale: next come buying, delivering, invoicing and collecting." },
      { at: ["/administracion/cupos", "/operaciones/sin-despachar"], where: { es: "Cupos y Sin despachar", en: "Credit limits and Not dispatched" }, es: "Aquí cuenta como dinero ya comprometido con el cliente aunque todavía no se haya facturado.", en: "Here it counts as money already committed with the customer even though it has not been invoiced yet." },
    ],
  },
  {
    id: "supplier-po", area: "operaciones", name: { es: "Supplier PO", en: "Supplier PO" }, forms: ["Supplier PO", "Supplier POs"], cs: true,
    def: { es: "Nuestra orden de compra al proveedor. Nace de la Necesidad (nadie la digita desde cero) y existe para cumplir una promesa a un cliente. Los pagos al proveedor se piden por hito desde ella.", en: "Our purchase order to the supplier. It is born from the Necessity (nobody types it from scratch) and exists to keep a promise to a customer. Supplier payments are requested by milestone from it." },
  },
  {
    id: "rfq", area: "operaciones", name: { es: "RFQ", en: "RFQ" }, forms: ["RFQ", "RFQs"], cs: true,
    def: { es: "Solicitud de cotización a un proveedor (Request for Quotation): le pedimos precio y plazo para una parte. Su respuesta alimenta la fuente de la Necesidad.", en: "Request for Quotation to a supplier: we ask for price and lead time for a part. The answer feeds the Necessity's source." },
  },
  {
    id: "cotizacion", area: "comercial", name: { es: "Cotización", en: "Quote" }, forms: ["Cotización", "cotización", "cotizaciones", "Cotizaciones", "Quote", "quote", "quotes", "Quotes"],
    def: { es: "La oferta que le presentamos al cliente: productos, precio, plazo y condiciones. Antes de presentarla es un borrador que se puede cambiar; después sus precios quedan fijos y un cambio se hace con una revisión.", en: "The offer we present to the customer: products, price, lead time and terms. Before it is presented it is a draft you can change; afterwards its prices are fixed and a change is made with a revision." },
    ctx: [
      { at: ["/localizar", "/compras", "/suppliers"], where: { es: "Localizar repuestos y proveedores", en: "Find parts and suppliers" }, es: "Ojo: aquí puede referirse a la oferta que nos dio el proveedor (su precio y plazo), no a la que le damos al cliente.", en: "Careful: here it may mean the offer the supplier gave us (their price and lead time), not the one we give the customer." },
      { at: ["/comercial/metas", "/informes", "/gerencia"], where: { es: "Metas e informes", en: "Goals and reports" }, es: "Aquí se cuentan las cotizaciones presentadas al cliente y las que el cliente decidió (aceptó o rechazó).", en: "Here it counts the quotes presented to the customer and those the customer decided on (accepted or declined)." },
    ],
  },
  {
    id: "fuente", area: "comercial", name: { es: "Fuente", en: "Source" }, forms: ["Fuente", "fuente", "Fuente encontrada", "Source", "Source found"], only: ["/deals", "/localizar", "/comunicacion"],
    def: { es: "De dónde va a salir el producto: qué proveedor, a qué precio y con qué plazo. «Fuente encontrada» es la etapa en la que ya sabemos quién lo puede suministrar.", en: "Where the product will come from: which supplier, at what price and lead time. \"Source found\" is the stage where we know who can supply it." },
    ctx: [{ at: ["/comunicacion"], where: { es: "Comunicación", en: "Communication" }, es: "Aquí es el mensaje o la llamada de donde salió el dato: queda guardado junto a él para saber quién lo dijo y cuándo.", en: "Here it is the message or call the piece of data came from: it is stored with it so we know who said it and when." }],
  },
  {
    id: "alcance", area: "comercial", name: { es: "Alcance", en: "Scope" }, forms: ["Alcance", "alcance", "matriz de alcance", "Scope", "scope"], only: ["/deals", "/cotizaciones"],
    def: { es: "Qué incluye y qué no incluye lo que vendemos (instalación, transporte, impuestos, repuestos…). Sirve para comparar ofertas de proveedores que incluyen cosas distintas y para que el cliente no espere algo que no cotizamos.", en: "What is and is not included in what we sell (installation, transport, taxes, spares…). It lets us compare supplier offers that include different things and keeps the customer from expecting something we did not quote." },
  },
  {
    id: "escenario", area: "comercial", name: { es: "Escenario", en: "Scenario" }, forms: ["Escenario", "escenario", "escenarios", "Escenarios", "Scenario", "scenario", "scenarios"],
    def: { es: "Una opción puesta al lado de otras para comparar antes de decidir.", en: "One option placed next to others to compare before deciding." },
    ctx: [
      { at: ["/cotizaciones", "/deals"], where: { es: "Cotización", en: "Quote" }, es: "Aquí es una alternativa que se le ofrece al cliente dentro de la misma cotización (por ejemplo aéreo más rápido o consolidado más barato). Agrégalos solo si el cliente gana algo al comparar.", en: "Here it is an alternative offered to the customer within the same quote (for example faster air or cheaper consolidated). Add them only if the customer gains something by comparing." },
      { at: ["/gerencia"], where: { es: "Gerencia", en: "Management" }, es: "Aquí es una comparación para una decisión de la empresa (subir un cupo, financiar una compra, comprar inventario). No es un pronóstico: guarda sus supuestos y sus rangos.", en: "Here it is a comparison for a company decision (raise a credit limit, finance a purchase, buy stock). It is not a forecast: it keeps its assumptions and ranges." },
    ],
  },
  {
    id: "liquidacion", area: "comercial", name: { es: "Liquidación", en: "Settlement" }, forms: ["Liquidación", "liquidación", "Liquidación de costos", "liquidar costos", "Settlement", "settlement"],
    def: { es: "Hacer la cuenta completa de algo hasta llegar a su valor final.", en: "Working out the full account of something down to its final value." },
    ctx: [
      { at: ["/cotizaciones", "/deals"], where: { es: "Cotización", en: "Quote" }, es: "Aquí es la cuenta de todos los costos del producto para poder cotizarlo: envío, impuestos, aduana, empaque, crédito a favor y valor de giro. Es una sola para toda la cotización.", en: "Here it is the account of all the product's costs so it can be quoted: shipping, taxes, customs, packing, credit in our favour and wire cost. There is one for the whole quote." },
      { at: ["/gerencia/liquidacion", "/gerencia/comisiones"], where: { es: "Comisiones", en: "Commissions" }, es: "Aquí es la lista de comisiones que hoy se pueden pagar, persona por persona, con su cálculo. Al aprobarla queda guardada tal como está.", en: "Here it is the list of commissions payable today, person by person, with the calculation. Once approved it is stored as it is." },
      { at: ["/visitas"], where: { es: "Viajes y visitas", en: "Trips and visits" }, es: "Aquí es cerrar las cuentas de un viaje: los gastos válidos frente al anticipo entregado.", en: "Here it is closing a trip's accounts: valid expenses against the advance given." },
    ],
  },
  {
    id: "credito-favor", area: "comercial", name: { es: "Crédito a favor", en: "Credit in our favour" }, forms: ["Crédito a favor", "crédito a favor", "Credit in our favour", "credit in our favour"],
    def: { es: "Un saldo que tenemos a nuestro favor con el proveedor o el transportador y que baja el costo de esta compra. No son días de plazo para pagar.", en: "A balance we hold in our favour with the supplier or carrier that lowers the cost of this purchase. It is not days of payment terms." },
  },
  {
    id: "giro", area: "comercial", name: { es: "Valor de giro", en: "Wire cost" }, forms: ["Valor de giro", "valor de giro", "Wire cost", "wire cost"],
    def: { es: "Lo que cobra el banco por enviar el dinero al proveedor. Es un costo más de la compra; no es el monto que se envía.", en: "What the bank charges to wire the money to the supplier. It is one more cost of the purchase; it is not the amount sent." },
  },
  {
    id: "trm", area: "comercial", name: { es: "TRM", en: "TRM" }, forms: ["TRM"], cs: true,
    def: { es: "Tasa Representativa del Mercado: cuántos pesos colombianos vale un dólar ese día.", en: "Colombia's official market exchange rate: how many Colombian pesos one dollar is worth that day." },
    ctx: [
      { at: ["/cotizaciones", "/deals"], where: { es: "Cotización en pesos", en: "Quote in pesos" }, es: "Aquí es la tasa que queda fija en la cotización: el cliente ve el precio en pesos calculado con ella, aunque el dólar se mueva después.", en: "Here it is the rate fixed on the quote: the customer sees the price in pesos calculated with it, even if the dollar moves later." },
      { at: ["/profile/autorizaciones"], where: { es: "Autorización por nivel", en: "Authorisation by level" }, es: "Aquí se usa la tasa de hoy solo para convertir la venta a pesos y saber qué nivel debe autorizarla.", en: "Here today's rate is used only to convert the sale to pesos and know which level must authorise it." },
    ],
  },
  {
    id: "iva", area: "administracion", name: { es: "IVA", en: "VAT (IVA)" }, forms: ["IVA", "VAT"], cs: true,
    def: { es: "Impuesto al valor agregado. Depende de cuál de nuestras empresas vende: la de Colombia lo cobra, la de Estados Unidos no. Las cifras de Eságara y venta se muestran antes de IVA.", en: "Value-added tax. It depends on which of our companies sells: the Colombian one charges it, the US one does not. Eságara and sales figures are shown before VAT." },
  },
  {
    id: "dian", area: "administracion", name: { es: "DIAN", en: "DIAN" }, forms: ["DIAN"], cs: true,
    def: { es: "La autoridad de impuestos de Colombia. La factura electrónica se emite en su sistema; SOLU solo registra el número y la fecha, no la emite.", en: "Colombia's tax authority. The electronic invoice is issued in its system; SOLU only records the number and date, it does not issue it." },
  },
  {
    id: "cobertura", area: "comercial", name: { es: "Cobertura", en: "Coverage" }, forms: ["Cobertura", "cobertura", "coberturas", "Coverage", "coverage"],
    def: { es: "Cuando alguien se ausenta, otra persona actúa sobre sus Necesidades por un tiempo definido. El dueño sigue siendo responsable y el permiso vence solo. Las aprobaciones por rol nunca se delegan así.", en: "When someone is away, another person acts on their Necessities for a set time. The owner stays responsible and the permission expires by itself. Role approvals are never delegated this way." },
    ctx: [{ at: ["/gerencia/cuentas"], where: { es: "Cuentas clave", en: "Key accounts" }, es: "Aquí es quién de nosotros atiende a ese cliente.", en: "Here it is who among us looks after that customer." }],
  },
  {
    id: "fuga", area: "comercial", name: { es: "Fuga", en: "Leak" }, forms: ["Fuga", "Fugas", "fugas", "Leak", "Leaks"], only: ["/comercial"],
    def: { es: "Dinero atrapado antes de convertirse en caja: vendido sin entregar, entregado sin facturar, facturado sin cobrar. Sirve para encontrar dónde se detiene el sistema, no para culpar a nadie.", en: "Money trapped before it becomes cash: sold but not delivered, delivered but not invoiced, invoiced but not collected. It is for finding where the system stalls, not for blaming anyone." },
  },
  {
    id: "foco", area: "comercial", name: { es: "Foco de alto valor", en: "High-value focus" }, forms: ["Foco de alto valor", "High-value focus"],
    def: { es: "Las Necesidades cuya Eságara supera el umbral definido. Se miran aparte porque un atraso en ellas pesa más.", en: "The Necessities whose Eságara is above the set threshold. They are watched separately because a delay there weighs more." },
  },
  {
    id: "contacto-util", area: "comercial", name: { es: "Contacto útil", en: "Useful contact" }, forms: ["Contacto útil", "Contactos útiles", "contactos útiles", "Useful contacts", "useful contacts"],
    def: { es: "Una conversación con el cliente que dejó algo: información, una necesidad, relación, quién decide, un próximo paso, una objeción o la fecha en que decidirá. Un intento sin respuesta no cuenta.", en: "A conversation with the customer that left something: information, a need, relationship, who decides, a next step, an objection or when they will decide. An attempt with no answer does not count." },
  },
  {
    id: "perfil-cliente", area: "comercial", name: { es: "Perfil (diario del cliente)", en: "Profile (customer diary)" }, forms: ["Perfiles", "diario del cliente", "customer diary"], only: ["/comercial"],
    def: { es: "El diario de cada cliente: qué le duele, con qué lucha en su trabajo y cómo lo vive cada persona. Se escribe después de cada conversación para llegar a la siguiente sabiendo dónde quedamos.", en: "Each customer's diary: what hurts, what they struggle with at work and how each person lives it. It is written after every conversation so we arrive at the next one knowing where we left off." },
  },
  // ── Mercado ──
  {
    id: "senal", area: "mercado", name: { es: "Señal", en: "Signal" }, forms: ["Señal", "señal", "señales", "Señales", "Signal", "signal", "signals"],
    def: { es: "Un indicio de que algo puede venir: un dato, un comentario o un cambio que todavía no es un pedido.", en: "A hint that something may be coming: a fact, a comment or a change that is not an order yet." },
    ctx: [
      { at: ["/mercado"], where: { es: "Mercado", en: "Market" }, es: "Aquí es algo que vimos u oímos de una empresa (una parada programada, una ampliación, un cambio de persona). Se guarda con su fuente; cuando el cliente cuenta una dificultad concreta, pasa a ser una Necesidad.", en: "Here it is something we saw or heard about a company (a planned shutdown, an expansion, a change of person). It is stored with its source; when the customer describes a concrete difficulty it becomes a Necessity." },
      { at: ["/deals"], where: { es: "Resultado de una Necesidad", en: "Result of a Necessity" }, es: "Aquí es una señal de continuidad: algo que el cliente dijo al cerrar y que puede traer un pedido futuro. No crea una Necesidad ni suma valor al pipeline; solo deja un recordatorio.", en: "Here it is a continuity signal: something the customer said at closing that may bring a future order. It creates no Necessity and adds no pipeline value; it only leaves a reminder." },
      { at: ["/gerencia/prioridades"], where: { es: "Prioridades", en: "Priorities" }, es: "Aquí es lo que nos avisará temprano si la prioridad va bien o mal.", en: "Here it is what will tell us early whether the priority is going well or badly." },
    ],
  },
  {
    id: "exploracion", area: "mercado", name: { es: "Exploración", en: "Exploration" }, forms: ["Exploración", "exploración", "exploraciones", "Exploraciones", "Exploration", "exploration", "explorations"],
    def: { es: "Un trabajo con fecha para entender una empresa, una planta o un sector antes de proponer nada: qué sabemos, qué no sabemos y con quién hablar. Cerrarla sin una Necesidad es un resultado válido.", en: "Dated work to understand a company, plant or sector before proposing anything: what we know, what we don't and who to talk to. Closing it without a Necessity is a valid outcome." },
  },
  {
    id: "espacio-sin-explorar", area: "mercado", name: { es: "Espacio sin explorar", en: "White space" }, forms: ["Espacios sin explorar", "Espacio sin explorar", "espacios en blanco", "White space", "white space"],
    def: { es: "Una parte del cliente donde podríamos ser útiles y todavía no hemos entrado: otra planta, otra línea, otra familia de productos.", en: "A part of the customer where we could be useful and have not entered yet: another plant, line or product family." },
  },
  {
    id: "oportunidad-futura", area: "mercado", name: { es: "Oportunidad futura", en: "Future opportunity" }, forms: ["Oportunidad futura", "oportunidad futura", "oportunidades futuras", "Oportunidades futuras", "Future opportunity", "future opportunities"],
    def: { es: "Un proyecto, una parada o una nueva planta que todavía no es una Necesidad. Se guarda con fecha para llegar a tiempo; no cuenta como venta.", en: "A project, shutdown or new plant that is not a Necessity yet. It is stored with a date so we arrive on time; it does not count as a sale." },
  },
  {
    id: "prospecto", area: "mercado", name: { es: "Prospecto", en: "Prospect" }, forms: ["Prospecto", "prospecto", "prospectos", "Prospectos", "Prospect", "prospects", "Prospects"],
    def: { es: "Una persona de una empresa que SOLU todavía no conoce, encontrada en Apollo por su cargo. Cuando la pasas a Clientes y Contactos deja de ser prospecto.", en: "A person at a company SOLU does not know yet, found in Apollo by job title. Once you move them to Customers and Contacts they stop being a prospect." },
  },
  {
    id: "revelar", area: "mercado", name: { es: "Revelar · crédito de Apollo", en: "Reveal · Apollo credit" }, forms: ["Revelar", "revelar", "revelados", "créditos de Apollo", "crédito de Apollo", "Reveal", "Apollo credit", "Apollo credits"], only: ["/mercado/prospectos"],
    def: { es: "Pedirle a Apollo los datos completos de una persona (nombre, correo de trabajo y LinkedIn). Cada persona revelada gasta 1 crédito de los que da el plan de Apollo cada mes. Buscar no gasta.", en: "Asking Apollo for a person's full details (name, work email and LinkedIn). Each person revealed uses 1 of the credits the Apollo plan gives each month. Searching uses none." },
  },
  // ── Operaciones ──
  {
    id: "requerimiento", area: "operaciones", name: { es: "Requerimiento", en: "Requirement" }, forms: ["Requerimiento", "requerimiento", "requerimientos", "Requerimientos", "Requirement", "requirements", "Requirements"],
    def: { es: "Lo que hay que comprar y para qué, antes de hacer la orden al proveedor. Lo comprado para un cliente va asignado a su Necesidad; lo que sobra es inventario y pide su propia autorización.", en: "What must be bought and what for, before placing the supplier order. What is bought for a customer is assigned to their Necessity; the rest is stock and needs its own authorisation." },
  },
  {
    id: "despacho", area: "operaciones", name: { es: "Despacho", en: "Dispatch" }, forms: ["Despacho", "despacho", "despachos", "Despachos", "Dispatch", "dispatch", "dispatches"],
    def: { es: "La salida física de la mercancía hacia el cliente. Despachado, entregado y listo para facturar son tres momentos distintos.", en: "The physical departure of the goods to the customer. Dispatched, delivered and ready to invoice are three different moments." },
    ctx: [{ at: ["/deals"], where: { es: "Dentro de una Necesidad", en: "Inside a Necessity" }, es: "Aquí Comercial da la instrucción de despacho (qué sale, a dónde y a quién); sin ella Operaciones no despacha.", en: "Here Commercial gives the dispatch instruction (what leaves, where to and to whom); without it Operations does not dispatch." }],
  },
  {
    id: "remision", area: "operaciones", name: { es: "Remisión", en: "Delivery note" }, forms: ["Remisión", "remisión", "remisiones", "Remisiones", "Delivery note", "delivery note", "delivery notes"],
    def: { es: "El documento que prueba una entrega: qué se entregó, a quién y cuándo, con la firma de quien recibió. Puede ser parcial. Sin ella no se puede facturar.", en: "The document that proves a delivery: what was delivered, to whom and when, signed by the receiver. It can be partial. Without it we cannot invoice." },
  },
  {
    id: "envio", area: "operaciones", name: { es: "Envío", en: "Shipment" }, forms: ["Envío", "envío", "envíos", "Envíos", "Shipment", "shipment", "shipments"], only: ["/logistica", "/deals", "/operaciones", "/compras"],
    def: { es: "El transporte de la mercancía desde el proveedor hasta nosotros o hasta el cliente, con su transportador, guía y fecha esperada. Courier es para paquetes pequeños y urgentes; carga, para lo grande o pesado.", en: "The transport of the goods from the supplier to us or to the customer, with its carrier, tracking number and expected date. Courier is for small urgent parcels; cargo for large or heavy ones." },
  },
  {
    id: "garantia", area: "operaciones", name: { es: "Garantía", en: "Warranty" }, forms: ["Garantía", "garantía", "garantías", "Garantías", "Warranty", "warranty", "warranties"],
    def: { es: "El tiempo durante el cual respondemos por lo entregado. Un caso de garantía se registra en la Necesidad; SOLU dice si estaba vigente el día del reporte, y su costo entra a los costos reales.", en: "The time during which we answer for what was delivered. A warranty case is recorded on the Necessity; SOLU says whether it was in force on the report date, and its cost goes into real costs." },
  },
  {
    id: "handoff", area: "operaciones", name: { es: "Handoff (entrega a Operaciones)", en: "Handoff" }, forms: ["Handoff", "handoff"],
    def: { es: "El momento en que Comercial le pasa el caso a Operaciones, al aceptar la OC del cliente: qué se prometió, a quién, para cuándo y con qué condiciones.", en: "The moment Commercial passes the case to Operations, when the customer PO is accepted: what was promised, to whom, by when and on what terms." },
  },
  {
    id: "expediente", area: "operaciones", name: { es: "Expediente", en: "File" }, forms: ["Expediente", "expediente", "Business file"],
    def: { es: "Todos los documentos de la Necesidad en un solo lugar: cotización, OC, órdenes al proveedor, remisiones y facturas.", en: "All the Necessity's documents in one place: quote, PO, supplier orders, delivery notes and invoices." },
  },
  {
    id: "comprometido", area: "operaciones", name: { es: "Comprometido", en: "Committed" }, forms: ["Comprometido", "comprometido", "comprometida", "comprometidos", "comprometidas", "Committed", "committed"],
    def: { es: "Ya está reservado para algo, aunque todavía no haya salido o no se haya pagado.", en: "Already reserved for something, even though it has not left or been paid yet." },
    ctx: [
      { at: ["/operaciones/inventario"], where: { es: "Inventario", en: "Stock" }, es: "Aquí son las unidades en bodega que ya pertenecen a una Necesidad: no están disponibles para otro cliente.", en: "Here they are the units in the warehouse that already belong to a Necessity: not available for another customer." },
      { at: ["/administracion", "/comercial/dinero"], where: { es: "Dinero", en: "Money" }, es: "Aquí es dinero que ya tiene destino (órdenes aceptadas, compras aprobadas): ya ocupa el presupuesto o el cupo aunque no se haya pagado ni facturado.", en: "Here it is money that already has a destination (accepted orders, approved purchases): it already uses the budget or the credit limit even if it has not been paid or invoiced." },
    ],
  },
  // ── Administración ──
  {
    id: "por-cobrar", area: "administracion", name: { es: "Por cobrar · cartera", en: "Outstanding · receivables" }, forms: ["Por cobrar", "por cobrar", "Cuentas por cobrar", "Cartera", "cartera", "Cartera vencida", "Outstanding", "Receivables", "Overdue"],
    def: { es: "Lo que los clientes nos deben de facturas ya emitidas, después de los pagos conciliados y las retenciones. «Vencida» es la parte cuya fecha de pago ya pasó.", en: "What customers owe us on issued invoices, after reconciled payments and withholdings. \"Overdue\" is the part whose due date has passed." },
  },
  {
    id: "conciliar", area: "administracion", name: { es: "Conciliar", en: "Reconcile" }, forms: ["Conciliar", "conciliar", "conciliado", "conciliados", "conciliada", "por conciliar", "Reconcile", "reconcile", "reconciled", "to reconcile"],
    def: { es: "Comprobar contra el extracto del banco que el dinero de verdad entró o salió. Un pago recibido no cuenta como pagado hasta que Tesorería lo concilia.", en: "Checking against the bank statement that the money really came in or went out. A received payment does not count as paid until Treasury reconciles it." },
  },
  {
    id: "retencion", area: "administracion", name: { es: "Retención", en: "Withholding" }, forms: ["Retención", "retención", "retenciones", "Withholding", "withholding", "withholdings"],
    def: { es: "La parte de la factura que el cliente no nos paga porque la entrega directamente a la autoridad de impuestos. La factura queda debiendo ese valor menos.", en: "The part of the invoice the customer does not pay us because they hand it directly to the tax authority. The invoice owes that much less." },
  },
  {
    id: "cupo", area: "administracion", name: { es: "Cupo", en: "Credit limit" }, forms: ["Cupo", "cupo", "cupos", "Cupos", "Cupo de crédito", "Credit limit", "credit limit"],
    def: { es: "Hasta cuánto le vendemos a un cliente a crédito. Lo usado se calcula solo (facturas sin conciliar más OC aceptadas sin facturar); el cupo lo fijan Finanzas o Gerencia.", en: "How much we sell to a customer on credit. What is used is calculated automatically (unreconciled invoices plus accepted POs not yet invoiced); the limit is set by Finance or Management." },
  },
  {
    id: "anticipo", area: "administracion", name: { es: "Anticipo", en: "Advance" }, forms: ["Anticipo", "anticipo", "anticipos", "Advance", "advance payment"],
    def: { es: "Dinero que se entrega antes de recibir lo que se paga.", en: "Money handed over before receiving what it pays for." },
    ctx: [
      { at: ["/visitas"], where: { es: "Viajes", en: "Trips" }, es: "Aquí es el dinero que la empresa le da a quien viaja antes de salir. Al volver se legalizan los gastos y se liquida la diferencia.", en: "Here it is the money the company gives the traveller before leaving. On return the expenses are documented and the difference settled." },
      { at: ["/administracion/cupos", "/compras", "/deals"], where: { es: "Clientes y proveedores", en: "Customers and suppliers" }, es: "Aquí es la parte que se paga por adelantado: la que el cliente nos paga antes de despachar, o la que le pagamos al proveedor para que empiece.", en: "Here it is the part paid up front: what the customer pays us before dispatch, or what we pay the supplier to start." },
    ],
  },
  {
    id: "hito", area: "administracion", name: { es: "Hito", en: "Milestone" }, forms: ["Hito", "hito", "hitos", "Milestone", "milestone", "milestones"],
    def: { es: "Un momento acordado con el proveedor en el que toca pagarle una parte (al ordenar, al embarcar, al recibir). Cada solicitud de pago nace de un hito de la Supplier PO.", en: "A moment agreed with the supplier when part of the payment is due (on order, on shipping, on receipt). Each payment request is born from a milestone on the Supplier PO." },
  },
  {
    id: "verificacion-independiente", area: "administracion", name: { es: "Verificación independiente", en: "Independent verification" }, forms: ["Verificación independiente", "verificación independiente", "Independent verification", "independent verification"],
    def: { es: "Confirmar los datos bancarios de un proveedor por un medio distinto al que llegó el cambio (por ejemplo una llamada a un número ya conocido). Protege contra fraudes por correo: sin ella el pago se detiene.", en: "Confirming a supplier's bank details through a different channel from the one the change arrived by (for example a call to a known number). It protects against email fraud: without it the payment stops." },
  },
  {
    id: "cierre-economico", area: "administracion", name: { es: "Cierre económico", en: "Economic close" }, forms: ["Cierre económico", "cierre económico", "economía cerrada", "Economic close", "economic close"],
    def: { es: "Dar por terminada la cuenta de una Necesidad. «Sustancialmente completa» evita dejarla abierta por diferencias pequeñas; «final» guarda las cifras de ese día y bloquea nuevos costos hasta reabrir.", en: "Declaring a Necessity's account finished. \"Substantially complete\" avoids keeping it open over small differences; \"final\" stores that day's figures and blocks new costs until reopened." },
  },
  {
    id: "comision", area: "administracion", name: { es: "Comisión", en: "Commission" }, forms: ["Comisión", "comisión", "comisiones", "Comisiones", "Commission", "commission", "commissions"],
    def: { es: "Lo que le corresponde a una persona por sus ventas: Eságara por la tasa de la política por su parte. La mitad se gana al facturar y la otra mitad en proporción a lo cobrado. Tiene cuatro estados que nunca se mezclan: estimada, por aprobar, aprobada y pagada.", en: "What a person is due for their sales: Eságara times the policy rate times their share. Half is earned at invoicing and half in proportion to what is collected. It has four states that are never mixed: estimated, to approve, approved and paid." },
    ctx: [{ at: ["/deals", "/cotizaciones"], sel: "form, label", where: { es: "Costos y diferencias de pago", en: "Costs and payment differences" }, es: "Ojo: en un costo o en una diferencia de pago puede ser la comisión que cobra el banco, no la de una persona.", en: "Careful: on a cost or a payment difference it may be the bank's fee, not a person's commission." }],
  },
  {
    id: "autoridad", area: "administracion", name: { es: "Autoridad · nivel de autorización", en: "Authority · authorisation level" }, forms: ["Autoridad", "autoridad", "Rangos de autorización", "Autorización por nivel", "nivel de autorización", "Authority", "authority", "Authorisation by level"],
    def: { es: "Hasta qué valor puede aprobar una persona sola y quién debe aprobar por encima. Cuando quien aprueba se ausenta puede prestar esa autoridad por un tiempo, con tope y fechas; la aprueba Gerencia y termina sola.", en: "Up to what value a person can approve alone and who must approve above that. When an approver is away they can lend that authority for a time, with a cap and dates; Management approves it and it ends by itself." },
  },
  // ── Equipo y Gerencia ──
  {
    id: "negociador", area: "equipo", name: { es: "Negociador comercial · operativo", en: "Commercial · operations negotiator" }, forms: ["Negociador Comercial", "Negociador Operativo", "Negociador comercial", "Negociador operativo", "negociador", "Negociador"],
    def: { es: "Los dos roles que llevan un caso. El Negociador Comercial atiende al cliente: entiende la necesidad, cotiza y acompaña hasta el resultado. El Negociador Operativo consigue el producto: proveedores, compra, envío y entrega.", en: "The two roles that carry a case. The Commercial Negotiator looks after the customer: understands the need, quotes and stays through to the result. The Operations Negotiator gets the product: suppliers, purchase, shipment and delivery." },
  },
  {
    id: "pulso", area: "gerencia", name: { es: "Pulso", en: "Pulse" }, forms: ["Pulso", "pulso", "Pulse"], only: ["/informes", "/gerencia"],
    def: { es: "El resumen del mes por función: qué descubrimos, qué vendimos, qué cumplimos y qué recursos cuidamos. Cada cifra lleva a su detalle.", en: "The month's summary by function: what we discovered, sold, delivered on and which resources we looked after. Each figure leads to its detail." },
  },
  {
    id: "puente-futuro", area: "gerencia", name: { es: "Puente al futuro", en: "Bridge to the future" }, forms: ["Puente al futuro", "Bridge to the future"],
    def: { es: "Lo que viene, desde lo que alguien vio venir hasta el dinero en el banco, en etapas que se leen una al lado de la otra y nunca se suman, porque cada una tiene una certeza distinta.", en: "What is coming, from what someone saw coming to money in the bank, in stages read side by side and never added up, because each has a different certainty." },
  },
  {
    id: "ecsa", area: "general", name: { es: "ECSA", en: "ECSA" }, forms: ["ECSA"], cs: true,
    def: { es: "La forma de trabajar de Industry Solutions: Explorar (entender antes de proponer), Conectar (con quien vive el problema), Solucionar (cumplir lo prometido) y Acompañar (hasta que el cliente logra su resultado).", en: "Industry Solutions' way of working: Explore (understand before proposing), Connect (with whoever lives the problem), Solve (deliver what was promised) and Accompany (until the customer achieves their result)." },
  },
  {
    id: "solu", area: "general", name: { es: "SOLU", en: "SOLU" }, forms: ["SOLU"], cs: true,
    def: { es: "Este sistema: Sistema Operativo de Logística de Urgencia. Recuerda lo que ya sabe, calcula lo que se puede calcular y te llama solo cuando hace falta tu criterio.", en: "This system: Sistema Operativo de Logística de Urgencia (urgent-logistics operating system). It remembers what it knows, calculates what can be calculated and calls you only when your judgment is needed." },
  },
];

const ESC = /[.*+?^${}()|[\]\\]/g;
const FORMS: { form: string; term: GlossTerm }[] = GLOSSARY.flatMap((t) => t.forms.map((form) => ({ form, term: t }))).sort((a, b) => b.form.length - a.form.length);
/** One expression for every form, longest first, whole words only. */
export const GLOSS_RE = new RegExp("(?<![\\p{L}\\p{N}])(" + FORMS.map((f) => f.form.replace(ESC, "\\$&")).join("|") + ")(?![\\p{L}\\p{N}])", "giu");
const BY_LOWER = new Map<string, GlossTerm>();
for (const f of FORMS) if (!BY_LOWER.has(f.form.toLowerCase())) BY_LOWER.set(f.form.toLowerCase(), f.term);

/** The term a matched piece of text belongs to on this screen, or null (wrong capitals, or not a term here). */
export function termFor(text: string, path: string): GlossTerm | null {
  const t = BY_LOWER.get(text.toLowerCase());
  if (!t) return null;
  if (t.cs && !t.forms.includes(text)) return null;
  if (t.only && !t.only.some((p) => path.startsWith(p))) return null;
  return t;
}

/** The meaning for this place: `inside` says whether the term sits inside a given CSS selector. */
export function contextFor(t: GlossTerm, path: string, search: string, inside: (sel: string) => boolean): GlossCtx | null {
  for (const c of t.ctx ?? []) {
    if (c.sel && !inside(c.sel)) continue;
    if (c.at && !c.at.some((a) => (a.startsWith("tab=") ? search.includes(a) : path.startsWith(a)))) continue;
    return c;
  }
  return null;
}
