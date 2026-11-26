import nodemailer from 'nodemailer';

let transporter;

const getTransporter = () => {
  if (!transporter) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
      throw new Error('SMTP chưa được cấu hình');
    }

    const port = Number(SMTP_PORT || 587);

    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD,
      },
      logger: false,
      debug: false,
    });
  }

  return transporter;
};

export const mailer = {
  async sendMail({ to, subject, text }) {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
  },
};