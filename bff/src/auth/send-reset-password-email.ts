const RESEND_API_URL = 'https://api.resend.com/emails';
const RESET_PASSWORD_SUBJECT = 'Reset your password';
const RESEND_TEST_RECIPIENT = 'delivered@resend.dev';

export async function sendResetPasswordEmail(email: string, token: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const isTestMode = process.env.RESEND_TEST_MODE === 'true';
    const from = isTestMode
        ? 'MemoTrip <onboarding@resend.dev>'
        : process.env.MAIL_FROM;
    const to = isTestMode ? RESEND_TEST_RECIPIENT : email;

    if (!apiKey) {
        throw new Error('RESEND_API_KEY is not configured');
    }

    if (!from) {
        throw new Error('MAIL_FROM is not configured');
    }

    const resetLink = `memotrip://reset-password?token=${encodeURIComponent(token)}`;
    const html = `
        <p>Reset your password</p>
        <a href="${resetLink}">
          Reset password
        </a>
    `;

    const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [to],
            subject: RESET_PASSWORD_SUBJECT,
            html,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Resend email send failed: ${response.status} ${errorText}`);
    }
}
