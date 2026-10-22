import { currentHost } from './host.mjs';
import { facts } from './profile.mjs';

/** Consent metadata only. Mailboxes, Messages and transient codes stay with the host. */
export function authenticationContext(store) {
    if (currentHost().id === 'claude') return {email_read:'user_only',sms_read:'user_only',preferred_channels:[],request_channels:[],scope:'user_entered_login_codes',host_access:store.get('settings','host_access',false)?.state ?? 'not_verified',permission_prompt:null};
    const permittedFacts = facts(store, 'form');
    const channels = ['email', 'sms'];
    const permissions = Object.fromEntries(channels.map(channel => {
        const fact = permittedFacts.find(f => f.key === `workflow.login.${channel}_read`);
        const revoked = store.all('fact').some(f => f.key === `workflow.login.${channel}_read` && f.scope === 'global' && f.state === 'revoked');
        if (revoked) return [channel, 'denied'];
        const explicit = fact?.evidence_level === 'self_statement' && typeof fact.source_ref === 'string' && !!fact.source_ref.trim() && typeof fact.value === 'boolean';
        return [channel, explicit ? fact.value ? 'granted' : 'denied' : 'not_requested'];
    }));
    const request = channels.filter(channel => permissions[channel] === 'not_requested');
    return {
        email_read: permissions.email, sms_read: permissions.sms,
        preferred_channels: channels.filter(channel => permissions[channel] === 'granted'),
        request_channels: request, scope: 'recruitment_login_codes_only', host_access: 'not_verified',
        permission_prompt: request.length ? `是否允许在你要求的招聘网站登录时，只读${request.map(channel => channel === 'email' ? '招聘验证码邮件' : '电脑可接收的招聘验证码短信')}并填写本次验证码？不发送或修改邮件、不保存验证码；拒绝不影响继续求职。` : null
    };
}
