/** GitHub Issues integration (fully implemented). */
import type { BugReport, GithubSettings } from '../core/types';
import { reportToMarkdown } from '../core/markdown';

export interface CreatedIssue {
  url: string;
  number: number;
}

export const GITHUB_ORIGIN = 'https://api.github.com/*';

export function parseRepository(repository: string): { owner: string; repo: string } {
  const match = repository
    .trim()
    .replace(/^https:\/\/github\.com\//, '')
    .match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Invalid repository "${repository}". Use the owner/repo format.`);
  }
  return { owner: match[1]!, repo: match[2]! };
}

/** Request the host permission needed to talk to the GitHub API. */
export async function ensureGithubPermission(): Promise<boolean> {
  try {
    if (await chrome.permissions.contains({ origins: [GITHUB_ORIGIN] })) return true;
    return await chrome.permissions.request({ origins: [GITHUB_ORIGIN] });
  } catch {
    return false;
  }
}

export async function createGithubIssue(
  report: BugReport,
  settings: GithubSettings,
  body?: string,
): Promise<CreatedIssue> {
  if (!settings.token) throw new Error('No GitHub token configured. Add one in Options.');
  const { owner, repo } = parseRepository(settings.repository);

  if (!(await ensureGithubPermission())) {
    throw new Error('Permission to reach api.github.com was denied.');
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      authorization: `token ${settings.token}`,
    },
    body: JSON.stringify({
      title: report.title || 'Bug report',
      body: body ?? reportToMarkdown(report, { includeMediaLinks: true }),
      labels: settings.labels,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 401) throw new Error('GitHub rejected the token (401).');
    if (response.status === 403) throw new Error('GitHub denied the request (403). Check scopes.');
    if (response.status === 404) {
      throw new Error('Repository not found, or the token cannot see it (404).');
    }
    throw new Error(`GitHub issue creation failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const issue = (await response.json()) as { html_url: string; number: number };
  return { url: issue.html_url, number: issue.number };
}
