import * as core from '@actions/core'
import * as github from '@actions/github'
import {context} from '@actions/github/lib/utils'
import {checkBody, checkTitle, checkBranch} from './checks'

const repoToken = core.getInput('repo-token', {required: true})
const bodyRegexInput = core.getInput('body-regex')
const bodyIgnoreAuthors = core.getMultilineInput('body-ignore-authors')
const bodyAutoClose = core.getBooleanInput('body-auto-close')
const bodyComment = core.getInput('body-comment')
const protectedBranch = core.getInput('protected-branch')
const protectedBranchAutoClose = core.getBooleanInput(
  'protected-branch-auto-close'
)
const protectedBranchComment = core.getInput('protected-branch-comment')
const titleComment = core.getInput('title-comment')
const titleCheckEnable = core.getBooleanInput('title-check-enable')
const filesToWatch = core.getMultilineInput('watch-files')
const watchedFilesComment = core.getInput('watch-files-comment')
const client = github.getOctokit(repoToken)
async function run(): Promise<void> {
  try {
    const ctx = github.context
    const pr = ctx.issue
    const author = ctx.payload.pull_request?.user?.login ?? ''
    const body = ctx.payload.pull_request?.body ?? ''
    const title = ctx.payload.pull_request?.title ?? ''
    const branch = ctx.payload.pull_request?.head?.ref ?? ''
    const filesModified = await listFiles({...pr, pull_number: pr.number})
    // bodyCheck passes if the author is to be ignored or if the check function passes
    const bodyCheck =
      bodyIgnoreAuthors.includes(author) || checkBody(body, bodyRegexInput)
    const {valid: titleCheck, errors: titleErrors} = !titleCheckEnable
      ? {valid: true, errors: []}
      : await checkTitle(title)
    const branchCheck = checkBranch(branch, protectedBranch)
    const filesFlagged = filesModified
      .map(file => file.filename)
      .filter(filename => filesToWatch.includes(filename))
    const prCompliant =
      bodyCheck && titleCheck && branchCheck && filesFlagged.length == 0
    const shouldClosePr =
      (bodyCheck === false && bodyAutoClose === true) ||
      (branchCheck === false && protectedBranchAutoClose === true)
    // Set Output values
    core.setOutput('body-check', bodyCheck)
    core.setOutput('branch-check', branchCheck)
    core.setOutput('title-check', titleCheck)
    core.setOutput('watched-files-check', filesFlagged.length == 0)

    if (!prCompliant) {
      // Handle failed body check
      if (!bodyCheck) {
        if (bodyComment !== '') await createComment(pr.number, bodyComment)
        core.warning('PR Body did not match required format')
      }
      if (!branchCheck) {
        if (protectedBranchComment !== '')
          await createComment(pr.number, protectedBranchComment)
        core.warning(
          `PR has ${protectedBranch} as its head branch, which is discouraged`
        )
      }
      if (!titleCheck) {
        const errorsComment =
          '\nLinting Errors\n\n' +
          titleErrors.map(error => `\n- ${error.message}`).join('')
        if (titleComment !== '')
          await createComment(pr.number, titleComment + errorsComment)
        core.error(
          `This PR's title should conform to @commitlint/conventional-commit`
        )
      }
      if (filesFlagged.length > 0) {
        const filesList =
          '\nFiles Matched\n\n' +
          filesFlagged.map(file => `\n- ${file}`).join('')
        if (watchedFilesComment !== '')
          await createComment(pr.number, watchedFilesComment + filesList)
        core.warning(
          `This PR modifies the following files: ${filesFlagged.join(', ')}`
        )
        // Finally close PR if warranted
      }
      if (shouldClosePr) await closePullRequest(pr.number)
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
async function createComment(number: number, comment: string) {
  if (comment.trim() !== '')
    await client.rest.issues.createComment({
      ...context.repo,
      issue_number: number,
      body: comment
    })
}
async function closePullRequest(number: number) {
  await client.rest.pulls.update({
    ...context.repo,
    pull_number: number,
    state: 'closed'
  })
}
async function listFiles(pullRequest: {
  owner: string
  repo: string
  pull_number: number
}) {
  const {data: files} = await client.rest.pulls.listFiles(pullRequest)
  return files
}
run()
