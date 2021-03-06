import Promise from 'bluebird'

import Boom from 'boom'
import Joi from 'joi'

import { torrentRepository } from '../torrents/TorrentRepository'
import { torrentService } from '../torrents/TorrentService'

const jwt = Promise.promisifyAll(require('jsonwebtoken'))

const list = {
  method: 'GET',
  path: '/torrents',
  handler: async (request, reply) => {
    try {
      const [torrentsModels, torrentsStats] = await Promise.all([
        torrentRepository.getAll(),
        torrentService.loadTorrentsStats()
      ])

      const torrents = torrentsModels.map((item) => {
        const stats = torrentsStats[item.hashString]
        item.name = stats.name
        item.downloadedEver = stats.downloadedEver
        item.uploadedEver = stats.uploadedEver
        item.status = stats.status
        item.totalSize = stats.totalSize
        item.percentDone = stats.percentDone
        item.rateDownload = stats.rateDownload
        item.rateUpload = stats.rateUpload
        return item
      })

      reply({ torrents })
    } catch (ex) {
      reply(ex)
    }
  }
}

const createFromFile = {
  method: 'POST',
  path: '/torrents/file',
  config: {
    payload: {
      allow: 'multipart/form-data',
      maxBytes: 2097152, // 2MB
      output: 'file'
    }
  },
  handler: async (request, reply) => {
    try {
      const created = await torrentService.addFile(request.payload.file.path)
      const body = await torrentRepository.create(
        request.auth.credentials.userId,
        created.hashString,
        created.name
      )

      reply(body)
    } catch (ex) {
      if (ex.code === '23505') {
        // Unque constraint violation, return 409 - Conflict
        reply(Boom.conflict('Torrent already exists'))
      } else {
        reply(ex)
      }
    }
  }
}

const createFromLink = {
  method: 'POST',
  path: '/torrents/link',
  config: {
    validate: {
      payload: {
        link: Joi.string().required()
      }
    }
  },
  handler: async (request, reply) => {
    try {
      const created = await torrentService.addUrl(request.payload.link)
      const body = await torrentRepository.create(
        request.auth.credentials.userId,
        created.hashString,
        created.name
      )

      reply(body)
    } catch (ex) {
      if (ex.code === '23505') {
        // Unque constraint violation, return 409 - Conflict
        reply(Boom.conflict('Torrent already exists'))
      } else {
        reply(ex)
      }
    }
  }
}

const get = {
  method: 'GET',
  path: '/torrents/{torrentId}',
  config: {
    validate: {
      params: {
        torrentId: Joi.number().required()
      }
    }
  },
  handler: async (request, reply) => {
    try {
      const torrentModel = await torrentRepository.get(request.params.torrentId)
      if (torrentModel) {
        const torrentStats = await torrentService.loadTorrentStats(torrentModel.hashString)

        torrentModel.name = torrentStats.name
        torrentModel.downloadedEver = torrentStats.downloadedEver
        torrentModel.uploadedEver = torrentStats.uploadedEver
        torrentModel.status = torrentStats.status
        torrentModel.totalSize = torrentStats.totalSize
        torrentModel.bytesCompleted = torrentStats.bytesCompleted
        torrentModel.percentDone = torrentStats.percentDone
        torrentModel.rateDownload = torrentStats.rateDownload
        torrentModel.rateUpload = torrentStats.rateUpload
        torrentModel.files = torrentStats.files

        reply(torrentModel)
      } else {
        reply(Boom.notFound())
      }
    } catch (ex) {
      reply(ex)
    }
  }
}

const getToken = {
  method: 'GET',
  path: '/torrents/{torrentId}/files/{fileIndex}/token',
  config: {
    validate: {
      params: {
        torrentId: Joi.number().required(),
        fileIndex: Joi.number().required()
      }
    }
  },
  handler: async (request, reply) => {
    try {
      const { torrentId, fileIndex } = request.params

      const torrentModel = await torrentRepository.get(torrentId)
      const torrentStats = await torrentService.loadTorrentStats(torrentModel.hashString)

      if (typeof torrentStats.files[fileIndex] !== 'undefined') {
        const filePath = torrentStats.files[fileIndex].name
        const payload = { hashString: torrentModel.hashString, filePath }
        reply({ token: await jwt.sign(payload, 'secret', { expiresIn: '24h' }) })
      } else {
        reply(Boom.notFound())
      }
    } catch (ex) {
      reply(ex)
    }
  }
}

const getTokenAllFiles = {
  method: 'GET',
  path: '/torrents/{torrentId}/token',
  config: {
    validate: {
      params: {
        torrentId: Joi.number().required()
      },
      query: {
        path: Joi.string()
      }
    }
  },
  handler: async (request, reply) => {
    try {
      const { torrentId } = request.params
      const { path } = request.query
      const torrentModel = await torrentRepository.get(torrentId)
      const payload = { hashString: torrentModel.hashString, filePath: path || torrentModel.name }

      reply({ token: await jwt.sign(payload, 'secret', { expiresIn: '24h' }) })
    } catch (ex) {
      reply(ex)
    }
  }
}

const remove = {
  method: 'DELETE',
  path: '/torrents/{torrentId}',
  config: {
    validate: {
      params: {
        torrentId: Joi.number().required()
      }
    }
  },
  handler: async (request, reply) => {
    const torrentModel = await torrentRepository.get(request.params.torrentId)
    if (torrentModel) {
      await torrentService.remove(torrentModel.hashString)
      await torrentRepository.remove(torrentModel.id)
      reply()
    } else {
      reply(Boom.notFound())
    }
  }
}

export default [list, createFromFile, createFromLink, get, getToken, getTokenAllFiles, remove]
