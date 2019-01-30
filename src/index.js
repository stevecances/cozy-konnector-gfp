const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveBills,
  log
} = require('cozy-konnector-libs')
const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very useful for
  // debugging but very verbose. That is why it is commented out by default
  // debug: true,
  // activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true
})

const baseUrl = 'https://assure.plansante.com/assures'

module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/paiements`)
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)
  log('debug', documents)

  // here we use the saveBills function even if what we fetch are not bills, but this is the most
  // common case in connectors
  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields, {
    // this is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['paiements']
  })
}

// this shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
function authenticate(username, password) {
  return signin({
    url: `${baseUrl}/auth`,
    formSelector: 'form',
    formData: { identifier: username, password: password },
    // the validate function will check if the login request was a success. Every website has
    // different ways respond: http status code, error message in html ($), http redirection
    // (fullResponse.request.uri.href)...
    validate: (statusCode, $) => {
      if ($(`a[href='/assures/deconnect']`).length === 1) {
        log('info', 'Authenticating success')
        return true
      } else {
        // cozy-konnector-libs has its own logging function which format these logs with colors in
        // standalone and dev mode and as JSON in production mode
        log('error', $('ul.js-formErrors li').text(), 'Authenticating failed')
        return false
      }
    }
  })
}

// The goal of this function is to parse a html page wrapped by a cheerio instance
// and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($) {
  // you can find documentation about the scrape function here :
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  const docs = scrape(
    $,
    {
      title: {
        sel: 'div.col-md-3',
        parse: parseDate
      },
      date: {
        sel: 'div.col-md-3',
        parse: text => new Date(parseDate(text))
      },
      amount: {
        sel: 'div.col-md-2',
        parse: parseAmount
      },
      fileurl: {
        sel: 'div.row',
        fn: $node =>
          `${baseUrl}/paiements/download/${$($node[0].parent).index() - 3}`
      },
      filename: {
        sel: 'div.col-md-3',
        parse: text => `detail_remboursements_${parseDate(text)}.pdf`
      }
    },
    'div.well'
  )
  const importDate = new Date()
  return docs.map(doc => ({
    ...doc,
    currency: '€',
    vendor: 'GFP',
    metadata: {
      // it can be interesting that we add the date of import. This is not mandatory but may be
      // useful for debugging or data migration
      importDate: importDate,
      // document version, useful for migration after change of document structure
      version: 1
    }
  }))
}

function parseDate(text) {
  const regex = /.*?Date de remboursement\n.*?(\d{1,2})\/(\d{1,2})\/(\d{1,4}).*?/gm
  const matches = regex.exec(text.replace(/^\s+|\s+$/g, ''))
  return `${matches[3]}-${matches[2]}-${matches[1]}`
}

function parseAmount(text) {
  const regex = /.*?Montant\n.*?(\d+,?\d*) €.*?/gm
  const matches = regex.exec(text.replace(/^\s+|\s+$/g, ''))
  return parseFloat(matches[1].replace(',', '.'))
}
