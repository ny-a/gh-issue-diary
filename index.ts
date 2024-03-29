import { Octokit } from "@octokit/rest";
import fs from 'fs';
import * as process from 'process';

const dayNameAbbrev = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const GH_TOKEN = process.env.GH_TOKEN;
const dryRun = process.env.DRY_RUN === 'true';

const repository = process.env.REPOSITORY;
const contentPathPrefix = process.env.CONTENT_DIR || '';
const userName = process.env.ASSIGN_USER || undefined;
const diaryLabel = process.env.ISSUE_LABEL || undefined;
const targetDayOffsetString = process.env.TARGET_DAY_OFFSET;

if (repository === undefined) {
  console.error('REPOSITORY environment variable is not set.');
  process.exit(1);
}

const targetDayOffset = parseInt(targetDayOffsetString || '') || 0;

const [repoOwner, repoName] = repository.split('/')

const octokit = new Octokit({
  auth: GH_TOKEN,
  userAgent: 'ny-a/gh-issue-diary',
});

(async () => {
  const now = new Date();
  now.setHours(now.getHours() + 9); // convert ISOString (UTC) to JST
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
      .map((comment) => {
        const user = comment.user && comment.user.login !== userName ? ` (@${comment.user?.login})` : '';
        return `${dateStringToLocalTime(comment.created_at)}${user} ${comment.body}`;
      })
      .join('\n');

    const dayTitle = issue.title.replaceAll(' ', '_');
    const filePath = `${dayTitle}.txt`;
    const dirName = filePath.split('/').slice(0, -1).join('/');
    const body = `${issue.body}\n\n${comments}\n`;

    if (dirName !== '') {
      fs.mkdirSync(dirName, { recursive: true });
    }
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

  const targetDay = new Date(now.getTime());
  targetDay.setDate(targetDay.getDate() + targetDayOffset);

  const startOfYear = new Date(now.getTime());
  startOfYear.setMonth(0);
  startOfYear.setDate(1);
  const startOfNextYear = new Date(startOfYear.getTime());
  startOfNextYear.setFullYear(startOfNextYear.getFullYear() + 1);

  const dayOfYear = ((targetDay.getTime() - startOfYear.getTime()) / 1000 / 60 / 60 / 24) + 1;
  const totalDayOfThisYear = (startOfNextYear.getTime() - startOfYear.getTime()) / 1000 / 60 / 60 / 24;

  if (!dryRun) {
    const labels = diaryLabel !== undefined ? [diaryLabel] : [];
    const assignees = userName !== undefined ? [userName] : [];

    const issueOpenResult = await octokit.issues.create({
      owner: repoOwner,
      repo: repoName,
      title: `${contentPathPrefix}${targetDay.toISOString().slice(0, 10).replaceAll('-', '/')}`,
      body: `${targetDay.toISOString().slice(0, 10)} (${dayNameAbbrev[targetDay.getDay()]}.)
day of year: ${dayOfYear} / ${totalDayOfThisYear} (${(dayOfYear / totalDayOfThisYear * 100).toFixed(1)}%)`,
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
