"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

type Mode = "login" | "register" | "forgot";

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage("");
    const values = new FormData(event.currentTarget);
    const emailOrUsername = String(values.get("identity") ?? "").trim();
    const email = String(values.get("email") ?? "").trim().toLowerCase();
    const password = String(values.get("password") ?? "");
    try {
      if (mode === "register") {
        const result = await authClient.signUp.email({
          email,
          password,
          name: String(values.get("name") ?? "").trim(),
          username: String(values.get("username") ?? "").trim().toLowerCase(),
        });
        if (result.error) throw new Error(result.error.message);
        window.location.reload();
      } else if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` });
        if (result.error) throw new Error(result.error.message);
        setMessage("Si el correo existe, recibirás un enlace de restablecimiento desde olcas.app.");
      } else {
        const result = emailOrUsername.includes("@")
          ? await authClient.signIn.email({ email: emailOrUsername.toLowerCase(), password })
          : await authClient.signIn.username({ username: emailOrUsername.toLowerCase(), password });
        if (result.error) throw new Error(result.error.message);
        window.location.reload();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la operación.");
    } finally { setLoading(false); }
  }

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <div className="brand-pill"><span>●</span> OLCAS GAMES</div>
        <div className="hero-copy">
          <p className="eyebrow">DE EMPLEADO A MAGNATE</p>
          <h1>Tu pequeño mercado.<br/><em>Tu gran imperio.</em></h1>
          <p>Trabaja, produce, contrata y abre franquicias en un mundo low-poly creado para jugar en cualquier dispositivo.</p>
          <div className="hero-features"><span>🌾 Producción real</span><span>👥 Empleados autónomos</span><span>🏪 Franquicias globales</span></div>
        </div>
        <div className="market-illustration" aria-hidden="true">
          <div className="sun"/><div className="cloud cloud-a"/><div className="cloud cloud-b"/>
          <div className="store-shape"><div className="awning"/><div className="sign">MINI MARKET</div><div className="window">🍎　🥖　🥛</div><div className="door"/></div>
          <div className="little-worker">🦊</div><div className="plant">🌿</div>
        </div>
      </section>
      <section className="auth-card-wrap">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-logo"><span>🏪</span><div><strong>Mini Market</strong><small>Simulador empresarial 3D</small></div></div>
          <h2>{mode === "login" ? "Bienvenido de vuelta" : mode === "register" ? "Crea tu empresa" : "Recupera tu acceso"}</h2>
          <p className="muted">{mode === "login" ? "Tu tienda y tus empleados te esperan." : mode === "register" ? "Tu progreso quedará protegido en la nube." : "Te enviaremos un enlace seguro de un solo uso."}</p>
          {mode === "register" && <>
            <label>Tu nombre<input name="name" required minLength={2} autoComplete="name" placeholder="Ferney" /></label>
            <label>Nombre de usuario<input name="username" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_.]+" autoComplete="username" placeholder="ferney_market" /></label>
          </>}
          {mode === "login" ? <label>Correo o usuario<input name="identity" required autoComplete="username" placeholder="tu@correo.com" /></label> : <label>Correo electrónico<input name="email" type="email" required autoComplete="email" placeholder="tu@correo.com" /></label>}
          {mode !== "forgot" && <label>Contraseña<input name="password" type="password" required minLength={10} autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder="Mínimo 10 caracteres" /></label>}
          {error && <div className="form-error">{error}</div>}
          {message && <div className="form-success">{message}</div>}
          <button className="primary-button" disabled={loading}>{loading ? "Un momento…" : mode === "login" ? "Entrar al mercado" : mode === "register" ? "Crear perfil y jugar" : "Enviar enlace"}</button>
          <div className="auth-links">
            {mode === "login" && <button type="button" onClick={() => setMode("forgot")}>Olvidé mi contraseña</button>}
            <button type="button" onClick={() => setMode(mode === "register" ? "login" : mode === "login" ? "register" : "login")}>{mode === "register" ? "Ya tengo cuenta" : mode === "login" ? "Crear perfil nuevo" : "Volver al acceso"}</button>
          </div>
          <small className="privacy-note">🔒 Partida privada · Autosave cifrado en tránsito</small>
        </form>
      </section>
    </main>
  );
}
