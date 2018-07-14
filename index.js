const execa = require('execa')
const request = require('request')
const inquirer = require('inquirer')

const stores = ctx ? ctx.stores : null

function requestRemoteRepos () {
  return new Promise((resolve, reject) => {
    request(
      {
        url: 'https://api.github.com/users/fbi-templates/repos',
        headers: {
          'User-Agent': 'fbi-templates'
        }
      },
      (error, response, body) => {
        if (error) {
          return reject(error)
        }

        if (response && response.statusCode === 200) {
          resolve(body)
        }
      }
    )
  })
}

function getListChoices (repos) {
  let hasInstalled = false
  if (stores) {
    for (let i = 0, len = repos.length; i < len; i++) {
      if (stores[repos[i].name]) {
        hasInstalled = true
        break
      }
    }
  }

  const maxNameLength = repos.reduce(
    (maxLength, repo) =>
      (repo.name.length > maxLength ? repo.name.length : maxLength),
    0
  )

  return repos.map(repo => {
    const empty = hasInstalled ? `           ` : ''
    const status = stores && stores[repo.name] ? '(installed)' : empty
    return {
      name: `${repo.name.padEnd(maxNameLength, ' ')} ${status}   ${repo.desc}`,
      value: repo.name
    }
  })
}

async function addOrUpdate (repos) {
  const answerList = await inquirer.prompt([
    {
      type: 'list',
      name: 'repo',
      message: 'Available templates (Choose one to continue)',
      choices: getListChoices(repos)
    },
    {
      type: 'list',
      name: 'action',
      message: 'Choose a action to continue',
      choices: ['update', 'remove'],
      when (answers) {
        return stores[answers.repo]
      }
    },
    {
      type: 'list',
      name: 'action',
      message: 'Choose a action to continue',
      choices: ['add'],
      when (answers) {
        return !stores[answers.repo]
      }
    }
  ])

  const cmd = `fbi ${answerList.action} ${answerList.action === 'add' ? repos.find(r => r.name === answerList.repo).url : answerList.repo}`

  await execa.shell(cmd, {
    stdio: 'inherit'
  })

  return answerList.repo || ''
}

async function lsRemote () {
  const repos = await requestRemoteRepos()
  let reposParsed
  try {
    reposParsed = JSON.parse(repos)
  } catch (err) {}

  if (Array.isArray(reposParsed)) {
    reposParsed = reposParsed.map(repo => {
      return {
        name: repo.name,
        url: repo.clone_url,
        desc: repo.description
      }
    })
  }

  // concat local's
  Object.keys(stores).map(s => {
    if (!reposParsed.find(p => p.name === s)) {
      reposParsed.push({
        name: s,
        url: stores[s].repository,
        desc: stores[s].description,
        local: true
      })
    }
  })

  try {
    await addOrUpdate(reposParsed)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

module.exports = lsRemote
