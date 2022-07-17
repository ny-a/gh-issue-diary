import { Octokit } from "@octokit/rest";
import fs from 'fs';
import * as process from 'process';

const GH_TOKEN = process.env.GH_TOKEN;
const dryRun = process.env.DRY_RUN === 'true';

const repository = process.env.REPOSITORY;
const contentPathPrefix = process.env.CONTENT_DIR || '';
const userName = process.env.ASSIGN_USER || undefined;
const diaryLabel = process.env.ISSUE_LABEL || undefined;

if (repository === undefined) {
  console.error('REPOSITORY environment variable is not set.');
  process.exit(1);
}

const [repoOwner, repoName] = repository.split('/')

const octokit = new Octokit({
  auth: GH_TOKEN,
  userAgent: 'ny-a/gh-issue-diary',
});

(async () => {
  const now = new Date();
  const issueList = await octokit.paginate(octokit.issues.listForRepo, {
    owner: repoOwner,
    repo: repoName,
    labels: diaryLabel,
  })

  issueList.forEach(async (issue) => {
    console.log(issue.title);
    const issueComments = (await octokit.paginate(octokit.issues.listComments, {
      owner: repoOwner,
      repo: repoName,
      issue_number: issue.number,
    }))

    const comments = issueComments
      .map((comment) => `${dateStringToLocalTime(comment.created_at)} ${comment.body}`)
      .join('\n');

    const dayTitle = issue.title.replaceAll('-', '/');
    const monthTitle = dayTitle.slice(0, 7);
    const dirName = `${contentPathPrefix}${monthTitle}`;
    const filePath = `${contentPathPrefix}${dayTitle}.txt`;
    const body = `${issue.body}\n\n${comments}\n`;

    fs.mkdirSync(dirName, { recursive: true })
    fs.appendFileSync(filePath, body);

    if (!dryRun) {
      const issueCloseResult = await octokit.issues.update({
        owner: repoOwner,
        repo: repoName,
        issue_number: issue.number,
        state: 'closed',
      })
      if (issueCloseResult.status !== 200) {
        console.log('issueCloseResult error', issueCloseResult.status)
        return;
      }
    }
  });

  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);

  const startOfYear = new Date(now.getTime());
  startOfYear.setMonth(0);
  startOfYear.setDate(1);
  const startOfNextYear = new Date(startOfYear.getTime());
  startOfNextYear.setFullYear(startOfNextYear.getFullYear() + 1);

  const dayOfYear = ((tomorrow.getTime() - startOfYear.getTime()) / 1000 / 60 / 60 / 24) + 1;
  const totalDayOfThisYear = (startOfNextYear.getTime() - startOfYear.getTime()) / 1000 / 60 / 60 / 24;

  if (!dryRun) {
    const labels = diaryLabel !== undefined ? [diaryLabel] : [];
    const assignees = userName !== undefined ? [userName] : [];

    const issueOpenResult = await octokit.issues.create({
      owner: repoOwner,
      repo: repoName,
      title: tomorrow.toISOString().slice(0, 10),
      body: `day of year: ${dayOfYear} / ${totalDayOfThisYear} (${(dayOfYear / totalDayOfThisYear * 100).toFixed(1)}%)`,
      labels,
      assignees,
    })
    if (issueOpenResult.status !== 201) {
      console.log('issueOpenResult error', issueOpenResult.status)
      return;
    }
  }
})();

const dateStringToLocalTime = (s: string) => {
  const date = new Date(s);
  date.setHours(date.getHours() + 9);
  return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}:${date.getUTCSeconds().toString().padStart(2, '0')}`
}
