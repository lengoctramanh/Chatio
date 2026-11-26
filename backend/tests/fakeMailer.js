export const createFakeMailer = () => {
  const messages = [];
  let shouldFail = false;

  return {
    messages,

    async sendMail({ to, subject, text }) {
      if (shouldFail) {
        throw new Error('Fake mailer: delivery failed');
      }

      messages.push({ to, subject, text });
    },

    setFailure(value) {
      shouldFail = Boolean(value);
    },

    reset() {
      messages.length = 0;
      shouldFail = false;
    },
  };
};