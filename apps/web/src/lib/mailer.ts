import 'server-only';
import nodemailer from 'nodemailer';

let transport: nodemailer.Transporter | undefined;

export async function sendEmail(message: { to: string; subject: string; text: string }) {
  const url = process.env.SMTP_URL;
  if (!url) throw new Error('SMTP_URL is not set');
  transport ??= nodemailer.createTransport(url);
  await transport.sendMail({ from: process.env.EMAIL_FROM ?? 'FinPlan <no-reply@localhost>', ...message });
}
