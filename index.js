const execa = require('execa')
const request = require('request')
const inquirer = require('inquirer')

const data = {
  local: ctx.stores,
  remote: null,
  all: [],
  hasInstalled: ctx.stores && Object.keys(ctx.stores).length > 0
}

function dataMerge (local, remote) {
  if (remote) {
    Object.keys(remote).map(r => {
      const actions = []
      const _local = local[remote[r].name]
      if (_local) {
        if (
          _local.repo &&
          (_local.repo.startsWith('http') || _local.repo.startsWith('git'))
        ) {
          actions.push('update')
        }
        actions.push('remove')
        _local['actions'] = actions
        data.all.push(_local)
      } else {
        actions.push('add')
        remote[r]['actions'] = actions
        data.all.push(remote[r])
      }
      delete local[remote[r].name]
      delete remote[r]
    })
  }

  const localKeys = Object.keys(local)
  if (localKeys && localKeys.length) {
    localKeys.map(l => {
      const actions = ['remove']
      if (local[l].repo) {
        actions.unshift('update')
      }
      local[l]['actions'] = actions
      data.all.push(local[l])
      delete local[l]
    })
  }
}

function requestPromise (opts) {
  return new Promise((resolve, reject) => {
    request(opts, (error, response, body) => {
      if (error) {
        return reject(error)
      }

      if (response && response.statusCode === 200) {
        resolve(body)
      } else {
        reject(
          response && response.statusCode
            ? response.statusCode
            : 'request error'
        )
      }
    })
  })
}

async function getRemotes () {
  const timeout = 10 * 1000
  try {
    ctx.logger.log('Fetching remote templates...')
    const ret = await requestPromise({
      url: 'https://api.github.com/users/fbi-templates/repos',
      headers: {
        'User-Agent': 'fbi-templates'
      },
      timeout
    })

    try {
      const parsed = JSON.parse(ret)
      data.remote = {}
      parsed.map(p => {
        data.remote[p.name] = {
          name: p.name,
          fullname: p.name,
          type: p.name.startsWith(ctx.configs.TEMPLATE_PREFIX)
            ? 'project'
            : 'task',
          repo: p.clone_url,
          description: p.description
        }
      })
    } catch (err) {
      ctx.logger.error('data invalid')
    }
  } catch (err) {
    if (err.code === 'ESOCKETTIMEDOUT' || err.code === 'ETIMEDOUT') {
      ctx.logger.error(`Request timeout (${timeout})`)
    } else {
      ctx.logger.error(err)
    }
  }
}

function getListChoices (list) {
  const maxNameLength = list.reduce(
    (maxLength, item) =>
      (item.name.length > maxLength ? item.name.length : maxLength),
    0
  )

  return list.map(item => {
    const empty = data.hasInstalled ? `           ` : ''
    const status = item.actions.includes('remove') ? '(installed)' : empty
    return {
      name: `${item.name.padEnd(maxNameLength, ' ')} ${status}   ${item.description}`,
      value: item
    }
  })
}

async function doActions ({ items, action }) {
  const options = action === 'remove' ? ' -f' : ''
  const cmd = `fbi ${action}${options}`
  let params = ''
  items.map(async i => {
    if (!i.actions.includes(action)) {
      ctx.logger.warn(
        `'${i.name}' only support '${i.actions.join(', ')}' action`
      )
    } else {
      params += ` ${action === 'add' ? i.repo : i.name}`
    }
  })

  if (params) {
    ctx.logger.log(cmd + params)
    return execa.shell(cmd + params, {
      stdio: 'inherit'
    })
  }
}

async function listAll (all) {
  console.log()
  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'items',
      message: 'Available templates and tasks',
      choices: getListChoices(all),
      pageSize: 20
    },
    {
      type: 'list',
      name: 'action',
      message: 'Choose a action to continue',
      choices: ['add', 'update', 'remove'],
      when (a) {
        return a.items && a.items.length > 0
      }
    }
  ])

  return answers
}

async function manage () {
  await getRemotes()

  ctx.logger.log('Finding local templates...')
  dataMerge(data.local, data.remote)

  if (data.all.length < 1) {
    ctx.logger.error('Local templates not found')
    process.exit(0)
  }

  try {
    const answers = await listAll(data.all)
    if (answers && answers.items && answers.action) {
      await doActions(answers)
    } else {
      ctx.logger.warn('Nothing to do')
    }
  } catch (err) {
    ctx.logger.error(err)
    process.exit(1)
  }
}

module.exports = manage
