/**
 * Integration interface plus stubs.
 *
 * `github.ts` is the reference implementation. Each stub below documents the
 * exact API call that needs to be made — the surrounding plumbing (settings,
 * report formatting, permissions) is already in place.
 */
import type { BugReport, Settings } from '../core/types';
import { reportToMarkdown } from '../core/markdown';

export interface IntegrationResult {
  url?: string;
  message: string;
}

export interface Integration {
  id: string;
  label: string;
  isConfigured(settings: Settings): boolean;
  send(report: BugReport, settings: Settings): Promise<IntegrationResult>;
}

function notImplemented(label: string): never {
  throw new Error(`${label} integration is not implemented yet. See src/integrations/stubs.ts.`);
}

export const jiraIntegration: Integration = {
  id: 'jira',
  label: 'Jira',
  isConfigured: (settings) =>
    Boolean(settings.integrations.jira.baseUrl && settings.integrations.jira.apiToken),
  async send(report, settings) {
    // TODO: POST {baseUrl}/rest/api/3/issue with basic auth (email:apiToken) and
    // an Atlassian Document Format description built from `reportToMarkdown`.
    void report;
    void settings;
    return notImplemented('Jira');
  },
};

export const linearIntegration: Integration = {
  id: 'linear',
  label: 'Linear',
  isConfigured: (settings) => Boolean(settings.integrations.linear.apiKey),
  async send(report, settings) {
    // TODO: POST https://api.linear.app/graphql with the `issueCreate` mutation,
    // passing teamId, title and `reportToMarkdown(report)` as the description.
    void report;
    void settings;
    return notImplemented('Linear');
  },
};

export const slackIntegration: Integration = {
  id: 'slack',
  label: 'Slack',
  isConfigured: (settings) => Boolean(settings.integrations.slack.webhookUrl),
  async send(report, settings) {
    // TODO: POST the incoming-webhook URL with Block Kit blocks summarising the
    // report and linking to the uploaded report URL.
    void report;
    void settings;
    return notImplemented('Slack');
  },
};

export const webhookIntegration: Integration = {
  id: 'webhook',
  label: 'Generic webhook',
  isConfigured: (settings) => Boolean(settings.integrations.webhook.url),
  async send(report, settings) {
    // TODO: POST the JSON report, optionally signed with an HMAC of
    // `settings.integrations.webhook.secret` in an `X-BugCapture-Signature` header.
    void reportToMarkdown(report);
    void settings;
    return notImplemented('Webhook');
  },
};

export const integrationStubs: Integration[] = [
  jiraIntegration,
  linearIntegration,
  slackIntegration,
  webhookIntegration,
];
