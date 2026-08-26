import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { username } from "better-auth/plugins";
import { Resend } from "resend";
import { db } from "@/lib/db";

const appUrl = process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const trustedOrigins = [
  appUrl,
  ...(process.env.LOCAL_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

export const auth = betterAuth({
  appName: "Mini Market",
  baseURL: appUrl,
  secret: process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        console.error("RESEND_API_KEY ausente: no se pudo enviar el restablecimiento");
        return;
      }
      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from: "Mini Market <no-reply@olcas.app>",
        to: user.email,
        subject: "Restablece tu contraseña de Mini Market",
        html: `<div style="font-family:system-ui;background:#f3fbf6;padding:32px;color:#17352a"><h1>Mini Market</h1><p>Hola ${escapeHtml(user.name)},</p><p>Usa este enlace durante los próximos minutos para crear una contraseña nueva.</p><p><a style="display:inline-block;background:#ee6c4d;color:white;padding:12px 20px;border-radius:12px;text-decoration:none" href="${url}">Restablecer contraseña</a></p><p>Si no lo solicitaste, ignora este mensaje.</p></div>`,
      });
      if (result.error) throw new Error(`Resend: ${result.error.message}`);
    },
  },
  plugins: [
    username({ minUsernameLength: 3, maxUsernameLength: 24 }),
  ],
  rateLimit: { enabled: true, window: 60, max: 60 },
  advanced: { cookiePrefix: "market" },
});

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}
