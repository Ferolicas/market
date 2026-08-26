"use client";

import { useCallback, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { COUNTRIES, HATS, PRODUCTS, ROLE_INFO, SUPPLIERS } from "@/game/catalog";
import { countryMoneyScale, formatMoney } from "@/game/engine";
import { useMarketStore } from "@/game/store";
import type { CountryCode, EmployeeRole, HatId, ProductId } from "@/game/types";
import { MarketScene, type InteractionId, type InteractionPrompt } from "./MarketScene";
import { GameRuntime } from "./GameRuntime";
import { setMobileInput } from "./input";

type Panel = "stock" | "suppliers" | "team" | "map" | "finance" | "build" | "avatar" | "help" | null;

export function GameShell({ playerName }: { playerName: string }) {
  const game = useMarketStore((state) => state.game);
  const status = useMarketStore((state) => state.saveStatus);
  const message = useMarketStore((state) => state.message);
  const dispatch = useMarketStore((state) => state.dispatch);
  const saveGame = useMarketStore((state) => state.saveGame);
  const [panel, setPanel] = useState<Panel>(null);
  const [prompt, setPrompt] = useState<InteractionPrompt | null>(null);

  const interact = useCallback((id: InteractionId) => {
    if (id === "farm") dispatch({ type: "HARVEST" });
    if (id === "mill") dispatch({ type: "LOAD_FLOUR_MILL" });
    if (id === "bakery") dispatch({ type: "BAKE_BREAD" });
    if (id === "shelf") setPanel("stock");
    if (id === "checkout") dispatch({ type: "CHECKOUT" });
    if (id === "supplier") setPanel("suppliers");
    if (id === "office") setPanel("map");
    if (id === "door") dispatch({ type: "TOGGLE_STORE" });
  }, [dispatch]);

  if (!game) return <><GameRuntime/><div className="game-loading"><div className="loading-shop">🏪</div><strong>Preparando tu mercado…</strong><span>Sincronizando caja, empleados e inventario</span></div></>;
  const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
  const hour = `${String(Math.floor(game.minuteOfDay / 60) % 24).padStart(2, "0")}:${String(game.minuteOfDay % 60).padStart(2, "0")}`;
  const progress = ((game.xp % Math.max(120, game.level * game.level * 120)) / Math.max(120, game.level * 120)) * 100;

  return (
    <main className="game-shell">
      <GameRuntime />
      <div className="world"><MarketScene onPrompt={setPrompt} onInteract={interact} /></div>
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
        <div className="player-chip"><span>{game.avatar.hat === "frog" ? "🐸" : "🦊"}</span><div><strong>{playerName}</strong><small>Reputación {game.reputation}</small></div><button onClick={() => void saveGame()}>☁</button></div>
      </footer>

      {prompt && <button className="interaction-prompt" onClick={() => interact(prompt.id)}><kbd>E</kbd><span>{prompt.label}</span><small>Acércate y pulsa</small></button>}
      <MobileControls onAction={() => prompt && interact(prompt.id)} />
      {message && <div className="toast">{message}</div>}
      {game.tutorialStep === 0 && <SetupPanel gameCountry={game.countryCode} gameHat={game.avatar.hat} onCountry={(countryCode) => dispatch({ type: "SET_COUNTRY", countryCode })} onHat={(hat) => dispatch({ type: "SET_AVATAR", hat })} />}
      {panel && <ManagementPanel panel={panel} close={() => setPanel(null)} />}
      <button className="help-button" onClick={() => setPanel("help")}>?</button>
    </main>
  );
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

function SetupPanel({ gameCountry, gameHat, onCountry, onHat }: { gameCountry: CountryCode; gameHat: HatId; onCountry: (country: CountryCode) => void; onHat: (hat: HatId) => void }) {
  const [country, setCountry] = useState(gameCountry); const [hat, setHat] = useState(gameHat);
  return <div className="modal-backdrop"><section className="setup-panel"><div className="setup-copy"><span className="eyebrow">BIENVENIDO, FUNDADOR</span><h2>Crea tu empresa</h2><p>El país determina la moneda, la fiscalidad y los costes. Después no podrá cambiarse en esta partida.</p><div className="country-grid">{Object.values(COUNTRIES).map((item) => <button key={item.code} className={country === item.code ? "selected" : ""} onClick={() => setCountry(item.code)}><strong>{flag(item.code)} {item.name}</strong><small>{item.currency} · renta {Math.round(item.corporateTaxRate * 1000) / 10}%</small></button>)}</div></div><div className="avatar-setup"><div className="avatar-preview"><span>{HATS.find((item) => item.id === hat)?.emoji}</span><strong>{HATS.find((item) => item.id === hat)?.name}</strong></div><p>Elige tu primer sombrero</p><div className="hat-row">{HATS.map((item) => <button key={item.id} className={hat === item.id ? "selected" : ""} onClick={() => setHat(item.id)} title={item.name}>{item.emoji}</button>)}</div><button className="primary-button" onClick={() => { onHat(hat); onCountry(country); }}>Abrir mi primer Mini Market</button></div></section></div>;
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
      {panel === "avatar" && <div className="wardrobe"><div className="avatar-big">{HATS.find((item) => item.id === game.avatar.hat)?.emoji}</div><div className="hat-catalog">{HATS.map((hat) => <button key={hat.id} className={game.avatar.hat === hat.id ? "selected" : ""} onClick={() => dispatch({ type: "SET_AVATAR", hat: hat.id })}><span>{hat.emoji}</span><strong>{hat.name}</strong></button>)}</div><div className="color-pickers"><label>Camiseta<input type="color" value={game.avatar.shirt} onChange={(event) => dispatch({ type: "SET_AVATAR", shirt: event.target.value })} /></label><label>Piel<input type="color" value={game.avatar.skin} onChange={(event) => dispatch({ type: "SET_AVATAR", skin: event.target.value })} /></label></div></div>}
      {panel === "help" && <div className="help-grid"><article><kbd>WASD</kbd><kbd>↑↓←→</kbd><strong>Moverse</strong><p>Camina hasta cada estación. La cámara te sigue automáticamente.</p></article><article><kbd>E</kbd><kbd>ESPACIO</kbd><strong>Interactuar</strong><p>Cosecha, carga máquinas, repón y cobra al estar cerca.</p></article><article><kbd>🎮 A</kbd><strong>Mando</strong><p>Stick izquierdo para moverte y botón A para actuar.</p></article><article><kbd>◎</kbd><strong>Móvil</strong><p>Joystick izquierdo y botón Acción. Los menús son táctiles.</p></article><div className="tutorial-flow"><b>1. Cosecha trigo</b><span>→</span><b>2. Haz harina y pan</b><span>→</span><b>3. Surte</b><span>→</span><b>4. Abre y cobra</b><span>→</span><b>5. Contrata</b></div></div>}
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
