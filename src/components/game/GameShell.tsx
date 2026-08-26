"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { COUNTRIES, HATS, PRODUCTS, ROLE_INFO, SUPPLIERS } from "@/game/catalog";
import { countryMoneyScale, formatMoney } from "@/game/engine";
import { useMarketStore } from "@/game/store";
import type { AvatarConfig, CountryCode, EmployeeRole, ProductId } from "@/game/types";
import { MarketScene, type InteractionId, type InteractionPrompt } from "./MarketScene";
import { GameRuntime } from "./GameRuntime";
import { setMobileInput } from "./input";
import { AvatarCustomizer } from "./AvatarCustomizer";

type Panel = "stock" | "suppliers" | "team" | "map" | "finance" | "build" | "avatar" | "help" | null;

export function GameShell({ playerName }: { playerName: string }) {
  const game = useMarketStore((state) => state.game);
  const status = useMarketStore((state) => state.saveStatus);
  const message = useMarketStore((state) => state.message);
  const dispatch = useMarketStore((state) => state.dispatch);
  const saveGame = useMarketStore((state) => state.saveGame);
  const [panel, setPanel] = useState<Panel>(null);
  const [checkoutLocked, setCheckoutLocked] = useState(false);
  const [prompt, setPrompt] = useState<InteractionPrompt | null>(null);
  const [lastInteraction, setLastInteraction] = useState<{ id: InteractionId; sequence: number } | null>(null);
  const interactionSequence = useRef(0);
  const interactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (interactionTimer.current) clearTimeout(interactionTimer.current); }, []);
  useEffect(() => {
    if (!checkoutLocked) return;
    const leaveRegister = (event: KeyboardEvent) => { if (event.code === "Escape") setCheckoutLocked(false); };
    window.addEventListener("keydown", leaveRegister);
    return () => window.removeEventListener("keydown", leaveRegister);
  }, [checkoutLocked]);

  const interact = useCallback((id: InteractionId) => {
    interactionSequence.current += 1;
    setLastInteraction({ id, sequence: interactionSequence.current });
    if (interactionTimer.current) clearTimeout(interactionTimer.current);
    interactionTimer.current = setTimeout(() => setLastInteraction(null), 1050);
    if (id === "farm") dispatch({ type: "HARVEST" });
    if (id === "mill") dispatch({ type: "LOAD_FLOUR_MILL" });
    if (id === "bakery") dispatch({ type: "BAKE_BREAD" });
    if (id === "shelf") setPanel("stock");
    if (id === "checkout") setCheckoutLocked(true);
    if (id === "supplier") setPanel("suppliers");
    if (id === "office") setPanel("map");
    if (id === "door") dispatch({ type: "TOGGLE_STORE" });
  }, [dispatch]);

  if (!game) return <><GameRuntime/><div className="game-loading"><div className="loading-shop">🏪</div><strong>Preparando tu mercado…</strong><span>Sincronizando caja, empleados e inventario</span></div></>;
  const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
  const hour = `${String(Math.floor(game.minuteOfDay / 60) % 24).padStart(2, "0")}:${String(game.minuteOfDay % 60).padStart(2, "0")}`;
  const progress = ((game.xp % Math.max(120, game.level * game.level * 120)) / Math.max(120, game.level * 120)) * 100;
  const avatarHat = HATS.find((item) => item.id === game.avatar.hat);

  return (
    <main className="game-shell">
      <GameRuntime />
      <div className="world"><MarketScene onPrompt={setPrompt} onInteract={interact} lastInteraction={lastInteraction} checkoutLocked={checkoutLocked} /></div>
      <header className="hud-top glass-panel">
        <div className="hud-brand"><span>🏪</span><div><strong>{franchise.name}</strong><small>{franchise.city}</small></div></div>
        <div className="hud-stat money"><small>Caja global</small><strong>{formatMoney(game.balanceMinor, game)}</strong></div>
        <div className="hud-stat"><small>Día {game.day}</small><strong>{hour}</strong></div>
        <div className="hud-stat level"><small>Nivel {game.level}</small><div className="xp-track"><i style={{ width: `${Math.min(100, progress)}%` }}/></div></div>
        <button className={`store-status ${franchise.open ? "open" : "closed"}`} onClick={() => dispatch({ type: "TOGGLE_STORE" })}><i/>{franchise.open ? "ABIERTO" : "CERRADO"}</button>
      </header>

      <aside className="mission-card glass-panel">
        <div className="panel-heading"><span>🎯</span><div><strong>Objetivos del día</strong><small>Reinician al cerrar</small></div></div>
        {game.missions.map((mission) => <button key={mission.id} className={`mission ${mission.completed ? "done" : ""}`} onClick={() => mission.completed && !mission.claimed && dispatch({ type: "CLAIM_MISSION", missionId: mission.id })}>
          <span>{mission.completed ? mission.claimed ? "✓" : "🎁" : "○"}</span><div><strong>{mission.label}</strong><div className="mission-track"><i style={{ width: `${mission.progress / mission.target * 100}%` }}/></div><small>{mission.progress}/{mission.target} · {mission.claimed ? "Cobrada" : mission.completed ? "Toca para cobrar" : formatMoney(mission.rewardMinor, game)}</small></div>
        </button>)}
      </aside>

      <aside className="quick-menu glass-panel">
        <QuickButton icon="📦" label="Inventario" onClick={() => setPanel("stock")} />
        <QuickButton icon="🚚" label="Proveedores" onClick={() => setPanel("suppliers")} />
        <QuickButton icon="👥" label="Equipo" onClick={() => setPanel("team")} />
        <QuickButton icon="🗺️" label="Franquicias" onClick={() => setPanel("map")} />
        <QuickButton icon="📊" label="Finanzas" onClick={() => setPanel("finance")} />
        <QuickButton icon="🔨" label="Construir" onClick={() => setPanel("build")} />
        <QuickButton icon="🦊" label="Avatar" onClick={() => setPanel("avatar")} />
      </aside>

      <footer className="game-bottom">
        <div className={`save-chip ${status}`}><i/>{status === "saving" ? "Guardando…" : status === "offline" ? "Copia local" : status === "dirty" ? "Cambios pendientes" : "Guardado"}</div>
        <div className="player-chip"><span title={avatarHat ? `Gorro ${avatarHat.name}` : "Sin gorro"}>{avatarHat?.emoji ?? "👤"}</span><div><strong>{playerName}</strong><small>Reputación {game.reputation}</small></div><button onClick={() => void saveGame()}>☁</button></div>
      </footer>

      {prompt && !checkoutLocked && <button className="interaction-prompt" onClick={() => interact(prompt.id)}><kbd>E</kbd><span>{prompt.label}</span><small>Acércate y pulsa</small></button>}
      {!checkoutLocked && <MobileControls onAction={() => prompt && interact(prompt.id)} />}
      {checkoutLocked && <CheckoutRegister onLeave={() => setCheckoutLocked(false)} />}
      {message && <div className="toast">{message}</div>}
      {game.tutorialStep === 0 && <SetupPanel gameCountry={game.countryCode} gameAvatar={game.avatar} onCountry={(countryCode) => dispatch({ type: "SET_COUNTRY", countryCode })} onAvatar={(avatar) => dispatch({ type: "SET_AVATAR", ...avatar })} />}
      {panel && <ManagementPanel panel={panel} close={() => setPanel(null)} />}
      <button className="help-button" onClick={() => setPanel("help")}>?</button>
    </main>
  );
}

function CheckoutRegister({ onLeave }: { onLeave: () => void }) {
  const game = useMarketStore((state) => state.game)!;
  const dispatch = useMarketStore((state) => state.dispatch);
  const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId)!;
  const productId = (Object.keys(PRODUCTS) as ProductId[]).find((id) => franchise.shelves[id] > 0);
  const product = productId ? PRODUCTS[productId] : null;
  const subtotal = product ? Math.round(product.saleMinor * countryMoneyScale(game.countryCode)) : 0;
  const tax = Math.round(subtotal * COUNTRIES[game.countryCode].salesTaxRate);
  const total = subtotal + tax;
  const paymentMethod = (game.day + franchise.customersToday) % 2 === 0 ? "card" : "cash";
  const tendered = paymentMethod === "cash" && total ? cashTendered(total) : total;
  const change = Math.max(0, tendered - total);
  const canCharge = franchise.open && Boolean(productId);

  function charge() {
    if (!canCharge) return;
    dispatch({ type: "CHECKOUT", paymentMethod });
  }

  return <section className="checkout-console" aria-label="Caja registradora">
    <header>
      <div><small>PUESTO BLOQUEADO</small><strong>Caja registradora 01</strong></div>
      <button onClick={onLeave}>Salir de caja <kbd>ESC</kbd></button>
    </header>
    <div className="checkout-workspace">
      <div className="register-screen">
        <div className="register-status"><i className={canCharge ? "ready" : "waiting"}/><span>{!franchise.open ? "Tienda cerrada" : product ? "Cliente listo para pagar" : "Esperando productos con stock"}</span></div>
        {product ? <>
          <div className="scanned-product"><span>{product.emoji}</span><div><strong>{product.name}</strong><small>1 unidad escaneada</small></div><b>{formatMoney(subtotal, game)}</b></div>
          <div className="receipt-totals"><span>Subtotal <b>{formatMoney(subtotal, game)}</b></span><span>Impuesto de venta <b>{formatMoney(tax, game)}</b></span><strong>Total <b>{formatMoney(total, game)}</b></strong></div>
        </> : <div className="register-empty"><span>▦</span><strong>No hay artículos disponibles</strong><small>Surte las estanterías para atender al siguiente cliente.</small></div>}
      </div>
      <div className={`payment-terminal ${paymentMethod}`}>
        <small>EL CLIENTE HA ELEGIDO</small>
        <div className="payment-method-icon">{paymentMethod === "cash" ? "€" : "▣"}</div>
        <h3>{paymentMethod === "cash" ? "Pago en efectivo" : "Pago con tarjeta"}</h3>
        {paymentMethod === "cash" ? <div className="cash-breakdown"><span>Entrega <b>{formatMoney(tendered, game)}</b></span><span>Cambio <b>{formatMoney(change, game)}</b></span></div> : <p>El cliente acerca su tarjeta al datáfono. Comprueba el total y confirma el cobro.</p>}
        <button className="charge-button" disabled={!canCharge} onClick={charge}>{paymentMethod === "cash" ? `Entregar cambio y cobrar` : "Aceptar pago con tarjeta"}</button>
      </div>
    </div>
  </section>;
}

function cashTendered(totalMinor: number) {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, totalMinor))) - 1);
  const step = magnitude * 5;
  return Math.ceil(totalMinor / step) * step;
}

function QuickButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return <button onClick={onClick}><span>{icon}</span><small>{label}</small></button>;
}

function MobileControls({ onAction }: { onAction: () => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  function move(clientX: number, clientY: number) {
    const rect = base.current?.getBoundingClientRect(); if (!rect) return;
    const x = clientX - (rect.left + rect.width / 2); const y = clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(x, y); const limit = rect.width * 0.31; const scale = length > limit ? limit / length : 1;
    const next = { x: x * scale, y: y * scale }; setKnob(next); setMobileInput(next.x / limit, next.y / limit);
  }
  function stop() { setKnob({ x: 0, y: 0 }); setMobileInput(0, 0); }
  return <div className="mobile-controls"><div ref={base} className="joystick" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); move(event.clientX, event.clientY); }} onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && move(event.clientX, event.clientY)} onPointerUp={stop} onPointerCancel={stop}><i style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}/></div><button className="action-button" onPointerDown={onAction}><strong>A</strong><small>ACCIÓN</small></button></div>;
}

function SetupPanel({ gameCountry, gameAvatar, onCountry, onAvatar }: { gameCountry: CountryCode; gameAvatar: AvatarConfig; onCountry: (country: CountryCode) => void; onAvatar: (avatar: AvatarConfig) => void }) {
  const [country, setCountry] = useState(gameCountry); const [avatar, setAvatar] = useState(gameAvatar);
  return <div className="modal-backdrop"><section className="setup-panel setup-panel-expanded"><div className="setup-copy"><span className="eyebrow">BIENVENIDO, FUNDADOR</span><h2>Crea tu empresa</h2><p>El país determina la moneda, la fiscalidad y los costes. Después no podrá cambiarse en esta partida.</p><div className="country-grid">{Object.values(COUNTRIES).map((item) => <button key={item.code} className={country === item.code ? "selected" : ""} onClick={() => setCountry(item.code)}><strong>{flag(item.code)} {item.name}</strong><small>{item.currency} · renta {Math.round(item.corporateTaxRate * 1000) / 10}%</small></button>)}</div></div><div className="avatar-setup"><AvatarCustomizer avatar={avatar} compact onChange={(change) => setAvatar((current) => ({ ...current, ...change }))} /><button className="primary-button" onClick={() => { onAvatar(avatar); onCountry(country); }}>Abrir mi primer Mini Market</button></div></section></div>;
}

function ManagementPanel({ panel, close }: { panel: Exclude<Panel, null>; close: () => void }) {
  const game = useMarketStore((state) => state.game)!; const dispatch = useMarketStore((state) => state.dispatch); const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId)!;
  const title = { stock: "Inventario y estanterías", suppliers: "Central de proveedores", team: "Equipo y delegación", map: "Mapa de franquicias", finance: "Dirección financiera", build: "Obras y mobiliario", avatar: "Vestuario del fundador", help: "Cómo jugar" }[panel];
  return <div className="management-wrap" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="management-panel"><header><div><span className="eyebrow">MINI MARKET OS</span><h2>{title}</h2></div><button className="close-button" onClick={close}>×</button></header>
    <div className="management-body">
      {panel === "stock" && <div className="product-grid">{(Object.keys(PRODUCTS) as ProductId[]).map((id) => <article className="product-card" key={id}><span>{PRODUCTS[id].emoji}</span><div><strong>{PRODUCTS[id].name}</strong><small>Almacén {franchise.warehouse[id]} · Tienda {franchise.shelves[id]}</small></div><button disabled={!franchise.warehouse[id]} onClick={() => dispatch({ type: "STOCK", productId: id, quantity: 3 })}>Surtir 3</button></article>)}</div>}
      {panel === "suppliers" && <div className="supplier-list">{SUPPLIERS.map((supplier) => <article key={supplier.id} className={game.level < supplier.unlockLevel ? "locked" : ""}><div className="supplier-head"><div><strong>{supplier.name}</strong><small>{supplier.leadMinutes} min · descuento {Math.round(supplier.discount * 100)}%</small></div>{game.level < supplier.unlockLevel && <b>Nivel {supplier.unlockLevel}</b>}</div><div className="supplier-products">{(Object.keys(PRODUCTS) as ProductId[]).filter((id) => PRODUCTS[id].supplier === supplier.id).map((id) => <button key={id} disabled={game.level < supplier.unlockLevel} onClick={() => dispatch({ type: "ORDER", supplierId: supplier.id, productId: id, quantity: 10 })}><span>{PRODUCTS[id].emoji}</span><strong>{PRODUCTS[id].name}</strong><small>10 × {formatMoney(PRODUCTS[id].wholesaleMinor * countryMoneyScale(game.countryCode) * (1 - supplier.discount), game)}</small></button>)}</div></article>)}</div>}
      {panel === "team" && <div className="team-grid">{(Object.keys(ROLE_INFO) as EmployeeRole[]).map((role) => { const info = ROLE_INFO[role]; const hired = franchise.employees.filter((employee) => employee.role === role); return <article key={role} className={game.level < info.unlockLevel ? "locked" : ""}><span className="role-icon">{roleIcon(role)}</span><div><strong>{info.name}</strong><p>{info.description}</p><small>{hired.length ? `${hired.map((item) => item.name).join(", ")} · ` : ""}Nómina {formatMoney(info.salaryMinor * countryMoneyScale(game.countryCode), game)}/día</small></div><button disabled={game.level < info.unlockLevel} onClick={() => dispatch({ type: "HIRE", role })}>{game.level < info.unlockLevel ? `Nivel ${info.unlockLevel}` : "Contratar"}</button></article>; })}</div>}
      {panel === "map" && <div className="franchise-map"><div className="map-line"/>{game.franchises.map((item, index) => <article key={item.id} className={`${item.owned ? "owned" : ""} ${item.id === game.currentFranchiseId ? "current" : ""}`}><span>{index === game.franchises.length - 1 ? "🏙️" : "🏪"}</span><div><small>NIVEL {item.unlockLevel}</small><strong>{item.name}</strong><p>{item.city}</p><b>{item.owned ? `${item.employees.length} empleados · ★ ${item.rating.toFixed(1)}` : formatMoney(item.purchaseCostMinor, game)}</b></div>{item.owned ? <button disabled={item.id === game.currentFranchiseId} onClick={() => { dispatch({ type: "TRAVEL", franchiseId: item.id }); close(); }}>{item.id === game.currentFranchiseId ? "Estás aquí" : "Viajar"}</button> : <button disabled={game.level < item.unlockLevel} onClick={() => dispatch({ type: "BUY_FRANCHISE", franchiseId: item.id })}>Comprar</button>}</article>)}</div>}
      {panel === "finance" && <FinancePanel />}
      {panel === "build" && <div className="upgrade-grid">{(["shelves", "checkout", "expansion", "mill", "bakery"] as const).map((upgrade) => <article key={upgrade}><span>{upgradeIcon(upgrade)}</span><div><strong>{upgradeName(upgrade)}</strong><p>{upgradeDescription(upgrade)}</p></div><button onClick={() => dispatch({ type: "UPGRADE", upgrade })}>Mejorar</button></article>)}<article><span>📜</span><div><strong>Licencia comercial</strong><p>{franchise.licenseDaysLeft} días restantes. Obligatoria para abrir.</p></div><button onClick={() => dispatch({ type: "BUY_LICENSE" })}>Renovar 14 días</button></article></div>}
      {panel === "avatar" && <AvatarCustomizer avatar={game.avatar} onChange={(change) => dispatch({ type: "SET_AVATAR", ...change })} />}
      {panel === "help" && <div className="help-grid"><article><kbd>WASD</kbd><kbd>↑↓←→</kbd><strong>Moverse</strong><p>Camina por el local y el exterior. La vista elevada mantiene toda la tienda visible.</p></article><article><kbd>E</kbd><kbd>ESPACIO</kbd><strong>Interactuar</strong><p>Cosecha, carga máquinas, repón o bloquéate en la caja al estar cerca.</p></article><article><kbd>🎮 A</kbd><strong>Mando</strong><p>Stick izquierdo para moverte y botón A para actuar.</p></article><article><kbd>◎</kbd><strong>Móvil</strong><p>Joystick izquierdo y botón Acción. Los menús son táctiles.</p></article><div className="tutorial-flow"><b>1. Cosecha trigo</b><span>→</span><b>2. Haz harina y pan</b><span>→</span><b>3. Surte</b><span>→</span><b>4. Abre y cobra</b><span>→</span><b>5. Contrata</b></div></div>}
    </div>
    <footer className="panel-footer"><span>Empresa: {COUNTRIES[game.countryCode].name} · {game.currency}</span><div className="panel-actions"><button className="danger-soft" onClick={() => dispatch({ type: "CLOSE_DAY" })}>Cerrar jornada y contabilizar</button><button className="danger-soft" onClick={async () => { await authClient.signOut(); window.location.reload(); }}>Cerrar sesión</button></div></footer>
  </section></div>;
}

function FinancePanel() {
  const game = useMarketStore((state) => state.game)!; const country = COUNTRIES[game.countryCode]; const f = game.finances;
  const rows = [{ label: "Ingresos netos de ventas", value: f.grossRevenueMinor, positive: true }, { label: "Coste de mercancía", value: -f.costOfGoodsMinor }, { label: "Nóminas y cargas", value: -f.payrollMinor }, { label: "Alquiler, energía y operación", value: -f.operatingCostsMinor }, { label: "Impuesto sobre beneficio provisionado", value: -f.taxesMinor }];
  return <div className="finance-layout"><div className="finance-summary"><small>RESULTADO ACUMULADO</small><strong className={f.netProfitMinor >= 0 ? "positive" : "negative"}>{formatMoney(f.netProfitMinor, game)}</strong><p>Caja disponible: {formatMoney(game.balanceMinor, game)}</p></div><div className="ledger-table">{rows.map((row) => <div key={row.label}><span>{row.label}</span><b className={row.positive ? "positive" : ""}>{formatMoney(row.value, game)}</b></div>)}</div><div className="tax-card"><span>{flag(country.code)}</span><div><strong>Régimen simulado: {country.name}</strong><p>Renta corporativa {Math.round(country.corporateTaxRate * 1000) / 10}% · impuesto de ventas {Math.round(country.salesTaxRate * 1000) / 10}% · carga laboral aproximada {Math.round(country.payrollBurdenRate * 1000) / 10}%.</p><small>Modelo educativo simplificado. No constituye asesoría fiscal ni reproduce todas las reglas, deducciones o tributos locales.</small></div></div></div>;
}

function flag(code: CountryCode) { return ({ ES: "🇪🇸", US: "🇺🇸", CO: "🇨🇴", MX: "🇲🇽", AR: "🇦🇷", CL: "🇨🇱", PE: "🇵🇪" })[code]; }
function roleIcon(role: EmployeeRole) { return ({ farmer: "🌾", operator: "⚙️", stocker: "📦", cashier: "🧾", builder: "🔨", manager: "📋" })[role]; }
function upgradeIcon(id: string) { return ({ shelves: "🗄️", checkout: "💳", expansion: "🏗️", mill: "⚙️", bakery: "🥖" } as Record<string, string>)[id]; }
function upgradeName(id: string) { return ({ shelves: "Estanterías", checkout: "Caja y pagos", expansion: "Ampliación del local", mill: "Molino de harina", bakery: "Horno industrial" } as Record<string, string>)[id]; }
function upgradeDescription(id: string) { return ({ shelves: "Más capacidad y surtido automático.", checkout: "Atiende más clientes por ciclo.", expansion: "Espacio para equipos y producción.", mill: "Produce más harina por carga.", bakery: "Hornea más pan por tanda." } as Record<string, string>)[id]; }
