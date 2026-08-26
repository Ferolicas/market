"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";

export function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    const confirm = String(form.get("confirm"));
    if (password !== confirm) { setError("Las contraseñas no coinciden."); return; }
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) setError(result.error.message ?? "El enlace no es válido o expiró.");
    else setMessage("Contraseña actualizada. Ya puedes volver a entrar.");
  }
  return <main className="simple-page"><form className="auth-card compact" onSubmit={submit}><div className="auth-logo"><span>🏪</span><strong>Mini Market</strong></div><h1>Nueva contraseña</h1><label>Contraseña<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label><label>Repetir contraseña<input name="confirm" type="password" minLength={10} required autoComplete="new-password" /></label>{error && <div className="form-error">{error}</div>}{message && <div className="form-success">{message}</div>}<button className="primary-button">Guardar contraseña</button><Link className="text-link" href="/">Volver al inicio</Link></form></main>;
}
