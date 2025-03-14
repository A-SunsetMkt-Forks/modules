const fs = require('fs')
const { v4: uuid } = require('uuid')
const crypto = require('crypto')
const path = require('path')
const ellipsize = require('ellipsize')
const { gql } =  require('@apollo/client')
const { execFileSync } = require('child_process')

const { fetchFromGithub, replacePrivateImage } = require('./github-source')

function makeRepositoryQuery (name) {
  return gql`
{
  repository(owner: "Xposed-Modules-Repo", name: "${name}") {
    name
    description
    url
    homepageUrl
    collaborators(affiliation: DIRECT, first: 100) {
      edges {
        node {
          login
          name
        }
      }
    }
    readme: object(expression: "HEAD:README.md") {
      ... on Blob {
        text
      }
    }
    summary: object(expression: "HEAD:SUMMARY") {
      ... on Blob {
        text
      }
    }
    scope: object(expression: "HEAD:SCOPE") {
      ... on Blob {
        text
      }
    }
    sourceUrl: object(expression: "HEAD:SOURCE_URL") {
      ... on Blob {
        text
      }
    }
    hide: object(expression: "HEAD:HIDE") {
      ... on Blob {
        text
      }
    }
    additionalAuthors: object(expression: "HEAD:ADDITIONAL_AUTHORS") {
      ... on Blob {
        text
      }
    }
    latestRelease {
      name
      url
      isDraft
      description
      descriptionHTML
      createdAt
      publishedAt
      updatedAt
      tagName
      isPrerelease
      releaseAssets(first: 50) {
        edges {
          node {
            name
            contentType
            downloadUrl
            downloadCount
            size
          }
        }
      }
    }
    releases(first: 20) {
      edges {
        node {
          name
          url
          isDraft
          description
          descriptionHTML
          createdAt
          publishedAt
          updatedAt
          tagName
          isPrerelease
          isLatest
          releaseAssets(first: 50) {
            edges {
              node {
                name
                contentType
                downloadUrl
                downloadCount
                size
              }
            }
          }
        }
      }
    }
    updatedAt
    createdAt
    stargazerCount
  }
}
  `
}


const PAGINATION = 10
function makeRepositoriesQuery (cursor) {
  const arg = cursor ? `, after: "${cursor}"` : ''
  return gql`
{
  organization(login: "Xposed-Modules-Repo") {
    repositories(first: ${PAGINATION}${arg}, orderBy: {field: UPDATED_AT, direction: DESC}, privacy: PUBLIC) {
      edges {
        node {
          name
          description
          url
          homepageUrl
          collaborators(affiliation: DIRECT, first: 100) {
            edges {
              node {
                login
                name
              }
            }
          }
          readme: object(expression: "HEAD:README.md") {
            ... on Blob {
              text
            }
          }
          summary: object(expression: "HEAD:SUMMARY") {
            ... on Blob {
              text
            }
          }
          scope: object(expression: "HEAD:SCOPE") {
            ... on Blob {
              text
            }
          }
          sourceUrl: object(expression: "HEAD:SOURCE_URL") {
            ... on Blob {
              text
            }
          }
          hide: object(expression: "HEAD:HIDE") {
            ... on Blob {
              text
            }
          }
          additionalAuthors: object(expression: "HEAD:ADDITIONAL_AUTHORS") {
            ... on Blob {
              text
            }
          }
          latestRelease {
            name
            url
            isDraft
            description
            descriptionHTML
            createdAt
            publishedAt
            updatedAt
            tagName
            isPrerelease
            releaseAssets(first: 50) {
              edges {
                node {
                  name
                  contentType
                  downloadUrl
                  downloadCount
                  size
                }
              }
            }
          }
          releases(first: 20) {
            edges {
              node {
                name
                url
                isDraft
                description
                descriptionHTML
                createdAt
                publishedAt
                updatedAt
                tagName
                isPrerelease
                isLatest
                releaseAssets(first: 50) {
                  edges {
                    node {
                      name
                      contentType
                      downloadUrl
                      downloadCount
                      size
                    }
                  }
                }
              }
            }
          }
          updatedAt
          createdAt
          stargazerCount
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
}`
}

const generateGatsbyNode = (result, createNode) => {
  createNode({
    data: result.data,
    id: result.id || uuid(),
    // see https://github.com/ldd/gatsby-source-github-api/issues/19
    // provide the raw result to see errors, or other information
    rawResult: result,
    parent: null,
    children: [],
    internal: {
      type: 'GithubData',
      contentDigest: crypto
        .createHash('md5')
        .update(JSON.stringify(result))
        .digest('hex'),
      // see https://github.com/ldd/gatsby-source-github-api/issues/10
      // our node should have an 'application/json' MIME type, but we wish
      // transformers to ignore it, so we set its mediaType to text/plain for now
      mediaType: 'text/plain'
    }
  })
}

function parseRepositoryObject (repo) {
  if (repo.summary) {
    repo.summary = ellipsize(repo.summary.text.trim(), 512).trim()
  }
  if (repo.readme) {
    repo.readme = repo.readme.text
  }
  if (repo.sourceUrl) {
    repo.sourceUrl = repo.sourceUrl.text.replace(/[\r\n]/g, '').trim()
  }
  if (repo.additionalAuthors) {
    try {
      const additionalAuthors = JSON.parse(repo.additionalAuthors.text)
      const validAuthors = []
      if (additionalAuthors instanceof Array) {
        for (const author of additionalAuthors) {
          if (author && typeof author === 'object') {
            const validAuthor = {}
            for (const key of Object.keys(author)) {
              if (['type', 'name', 'link'].includes(key)) {
                validAuthor[key] = author[key]
              }
            }
            validAuthors.push(validAuthor)
          }
        }
      }
      repo.additionalAuthors = validAuthors
    } catch (e) {
      repo.additionalAuthors = null
    }
  }
  if (repo.scope) {
    try {
      repo.scope = JSON.parse(repo.scope.text)
    } catch (e) {
      repo.scope = null
    }
  }
  repo.hide = !!repo.hide
  if (repo.releases) {
    if (repo.latestRelease) {
      repo.releases.edges = [{ node: repo.latestRelease }, ...repo.releases.edges]
    }
    repo.releases.edges = repo.releases.edges
      .filter(({ node: { releaseAssets, isDraft, isLatest, tagName } }) =>
        !isLatest && !isDraft && releaseAssets && tagName.match(/^\d+-.+$/) && releaseAssets.edges
          .some(({ node: { contentType } }) => contentType === 'application/vnd.android.package-archive'))
  }
  repo.isModule = !!(repo.name.match(/\./) &&
    repo.description &&
    repo.releases &&
    repo.releases.edges.length &&
    repo.name !== 'org.meowcat.example' && repo.name !== '.github')
  if (repo.isModule) {
    for (const release of repo.releases.edges) {
      release.node.descriptionHTML = replacePrivateImage(release.node.description, release.node.descriptionHTML)
    }
    repo.latestRelease = repo.releases.edges.find(({ node: { isPrerelease } }) => !isPrerelease)
    repo.latestReleaseTime = '1970-01-01T00:00:00Z'
    if (repo.latestRelease) {
      repo.latestRelease = repo.latestRelease.node
      repo.latestReleaseTime = repo.latestRelease.publishedAt
      repo.latestRelease.isLatest = true
    }
    repo.latestBetaRelease = repo.releases.edges.find(({ node: { isPrerelease, name } }) => isPrerelease && !name.match(/^(snapshot|nightly).*/i)) || { node: repo.latestRelease }
    repo.latestBetaReleaseTime = '1970-01-01T00:00:00Z'
    if (repo.latestBetaRelease) {
      repo.latestBetaRelease = repo.latestBetaRelease.node
      repo.latestBetaReleaseTime = repo.latestBetaRelease.publishedAt
      repo.latestBetaRelease.isLatestBeta = true
    }
    repo.latestSnapshotRelease = repo.releases.edges.find(({ node: { isPrerelease, name } }) => isPrerelease && name.match(/^(snapshot|nightly).*/i)) || { node: repo.latestBetaRelease }
    repo.latestSnapshotReleaseTime = '1970-01-01T00:00:00Z'
    if (repo.latestSnapshotRelease) {
      repo.latestSnapshotRelease = repo.latestSnapshotRelease.node
      repo.latestSnapshotReleaseTime = repo.latestSnapshotRelease.publishedAt
      repo.latestSnapshotRelease.isLatestSnapshot = true
    }
  }
  console.log(`Got repo: ${repo.name}, is module: ${repo.isModule}`)
  return repo
}

exports.onCreateNode = async ({
  node,
  actions,
  createContentDigest,
  cache
}) => {
  const { createNode } = actions
  if (node.internal.type === 'GithubData' && node.data) {
    for (let { node: repo } of node.data.organization.repositories.edges) {
      repo = JSON.parse(JSON.stringify(repo))
      repo = parseRepositoryObject(repo)
      try {
        repo.readmeHTML = execFileSync(
          './bin/cmark-gfm',
          ['--smart', '--validate-utf8', '--github-pre-lang', '-e', 'footnotes', '-e', 'table', '-e', 'strikethrough', '-e', 'autolink', '-e', 'tagfilter', '-e', 'tasklist', '--unsafe', '--strikethrough-double-tilde', '-t', 'html'],
          { input: repo.readme },
        ).toString()
      } catch (err) {
        if (err.code) {
          console.error(err.code);
        } else {
          const { stdout, stderr } = err;
          console.error({ stdout, stderr });
        }
      }
      await createNode({
        ...repo,
        id: repo.name,
        parent: null,
        children: repo.readme ? [repo.name + '-readme'] : [],
        internal: {
          type: 'GithubRepository',
          contentDigest: crypto
            .createHash('md5')
            .update(JSON.stringify(repo))
            .digest('hex'),
          mediaType: 'application/json'
        }
      })
    }
  }
  if (node.internal.type === 'GithubRepository' && node.readme) {
    createNode({
      id: node.id + '-readme',
      parent: node.id,
      internal: {
        type: 'GitHubReadme',
        mediaType: 'text/markdown',
        content: node.readme,
        contentDigest: createContentDigest(node.readme)
      }
    })
  }
}

exports.sourceNodes = async (
  { actions }
) => {
  const { createNode } = actions
  let cursor = null
  let page = 1
  let total
  let mergedResult = {
    data: {
      organization: {
        repositories: {
          edges: []
        }
      }
    }
  }
  const repo_name = process.env.REPO ? process.env.REPO.split('/')[1] : null
  if (repo_name && fs.existsSync('./cached_graphql.json')) {
    const data = fs.readFileSync('./cached_graphql.json')
    mergedResult = JSON.parse(data)
    mergedResult.data.organization.repositories.edges.forEach((value, index, array) => {
      if (value.node.name === repo_name) {
        array.splice(index, 1)
      }
    })
    console.log(`Fetching ${repo_name} from GitHub API`)
    const result = await fetchFromGithub(makeRepositoryQuery(repo_name))
    if (result.errors || !result.data) {
      const errMsg = result.errors || 'result.data is null'
      console.error(errMsg)
      throw errMsg
    }
    mergedResult.data.organization.repositories.edges.unshift({'node': result.data.repository})
  } else {
    while (true) {
      console.log(`Querying GitHub API, page ${page}, total ${Math.ceil(total / PAGINATION) || 'unknown'}, cursor: ${cursor}`)
      const result = await fetchFromGithub(makeRepositoriesQuery(cursor))
      if (result.errors || !result.data) {
        const errMsg = result.errors || 'result.data is null'
        console.error(errMsg)
        throw errMsg
      }
      mergedResult.data.organization.repositories.edges =
        mergedResult.data.organization.repositories.edges.concat(result.data.organization.repositories.edges)
      if (!result.data.organization.repositories.pageInfo.hasNextPage) {
        break
      }
      cursor = result.data.organization.repositories.pageInfo.endCursor
      total = result.data.organization.repositories.totalCount
      page++
    }
  }
  fs.writeFileSync('./cached_graphql.json', JSON.stringify(mergedResult))
  generateGatsbyNode(mergedResult, createNode)
}

exports.createPages = async ({ graphql, actions }) => {
  const { createPage } = actions
  const indexPageResult = await graphql(`
{
  allGithubRepository(limit: 30, filter: {isModule: {eq: true}, hide: {eq: false}}) {
    pageInfo {
      pageCount
      perPage
    }
  }
}`)
  for (let i = 1; i <= indexPageResult.data.allGithubRepository.pageInfo.pageCount; i++) {
    createPage({
      path: `page/${i}`,
      component: path.resolve('./src/templates/index.tsx'),
      context: {
        skip: (i - 1) * indexPageResult.data.allGithubRepository.pageInfo.perPage,
        limit: indexPageResult.data.allGithubRepository.pageInfo.perPage
      }
    })
  }
  createPage({
    path: '/',
    component: path.resolve('./src/templates/index.tsx'),
    context: {
      skip: 0,
      limit: indexPageResult.data.allGithubRepository.pageInfo.perPage
    }
  })
  const modulePageResult = await graphql(`
{
  allGithubRepository(filter: {isModule: {eq: true}}) {
    edges {
      node {
        name
      }
    }
  }
}`)
  for (const { node: repo } of modulePageResult.data.allGithubRepository.edges) {
    createPage({
      path: `module/${repo.name}`,
      component: path.resolve('./src/templates/module.tsx'),
      context: {
        name: repo.name
      }
    })
  }
}

function flatten (object) {
  for (const key of Object.keys(object)) {
    if (object[key] !== null && object[key] !== undefined && typeof object[key] === 'object') {
      if (object[key].edges) {
        object[key] = object[key].edges.map(edge => edge.node)
      }
    }
    if (object[key] !== null && object[key] !== undefined && typeof object[key] === 'object') {
      flatten(object[key])
    }
  }
}

exports.onPostBuild = async ({ graphql }) => {
  const result = await graphql(`
{
  allGithubRepository(filter: {isModule: {eq: true}, hide: {eq: false}}) {
    edges {
      node {
        name
        description
        url
        homepageUrl
        collaborators {
          edges {
            node {
              login
              name
            }
          }
        }
        latestRelease {
          name
          url
          isDraft
          descriptionHTML
          createdAt
          publishedAt
          updatedAt
          tagName
          isPrerelease
          releaseAssets {
            edges {
              node {
                name
                contentType
                downloadUrl
                downloadCount
                size
              }
            }
          }
        }
        latestBetaRelease {
          name
          url
          isDraft
          descriptionHTML
          createdAt
          publishedAt
          updatedAt
          tagName
          isPrerelease
          releaseAssets {
            edges {
              node {
                name
                contentType
                downloadUrl
                downloadCount
                size
              }
            }
          }
        }
        latestSnapshotRelease {
          name
          url
          isDraft
          descriptionHTML
          createdAt
          publishedAt
          updatedAt
          tagName
          isPrerelease
          releaseAssets {
            edges {
              node {
                name
                contentType
                downloadUrl
                downloadCount
                size
              }
            }
          }
        }
        latestReleaseTime
        latestBetaReleaseTime
        latestSnapshotReleaseTime
        releases {
          edges {
            node {
              name
              url
              isDraft
              descriptionHTML
              createdAt
              publishedAt
              updatedAt
              tagName
              isPrerelease
              releaseAssets {
                edges {
                  node {
                    name
                    contentType
                    downloadUrl
                    downloadCount
                    size
                  }
                }
              }
            }
          }
        }
        readme
        readmeHTML
        childGitHubReadme {
          childMarkdownRemark {
            html
          }
        }
        summary
        scope
        sourceUrl
        hide
        additionalAuthors {
          type
          name
          link
        }
        updatedAt
        createdAt
        stargazerCount
      }
    }
  }
}`)
  const rootPath = './public'
  if (!fs.existsSync(rootPath)) fs.mkdirSync(rootPath, { recursive: true })
  flatten(result)
  const modules = result.data.allGithubRepository
  for (const repo of modules) {
    const modulePath = path.join(rootPath, 'module')
    if (!fs.existsSync(modulePath)) fs.mkdirSync(modulePath, { recursive: true })
    const latestRelease = repo.latestRelease
    const latestBetaRelease = repo.latestBetaRelease
    const latestSnapshotRelease = repo.latestSnapshotRelease
    repo.latestRelease = latestRelease ? latestRelease.tagName : undefined
    repo.latestBetaRelease = latestBetaRelease && repo.latestRelease !== latestBetaRelease.tagName ? latestBetaRelease.tagName : undefined
    repo.latestSnapshotRelease = latestSnapshotRelease && repo.latestBetaRelease !== latestSnapshotRelease.tagName && repo.latestRelease !== latestSnapshotRelease.tagName ? latestSnapshotRelease.tagName : undefined
    fs.writeFileSync(`${modulePath}/${repo.name}.json`, JSON.stringify(repo))
    repo.releases = latestRelease ? [latestRelease] : []
    if (repo.latestBetaRelease) {
      repo.betaReleases = [latestBetaRelease]
    }
    if (repo.latestSnapshotRelease) {
      repo.snapshotReleases = [latestSnapshotRelease]
    }
    if (!repo.readmeHTML && repo.readme) repo.readmeHTML = repo.childGitHubReadme.childMarkdownRemark.html
    delete repo.readme
    delete repo.childGitHubReadme
  }
  fs.writeFileSync(`${rootPath}/modules.json`, JSON.stringify(modules))
}
