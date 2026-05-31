const fs = require('fs')
const path = require('path')

const EMAIL_LINE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isEmailLine(s) {
    return EMAIL_LINE.test(String(s || '').trim())
}

function loadEmails() {
    const dir = path.join(__dirname, '..', 'email')
    return new Promise(function (resolve) {
        fs.readdir(dir, function (err, files) {
            if (err) {
                return resolve([])
            }
            if (!files || files.length === 0) {
                return resolve([])
            }
            const list = []
            let pending = files.length
            files.forEach(function (fileName) {
                const fp = path.join(dir, fileName)
                fs.readFile(fp, 'utf8', function (error, data) {
                    if (!error && data) {
                        data.split(/\r?\n/).forEach(function (line) {
                            const t = line.trim()
                            if (t && isEmailLine(t)) {
                                list.push(t)
                            }
                        })
                    }
                    pending--
                    if (pending === 0) {
                        resolve(Array.from(new Set(list)))
                    }
                })
            })
        })
    })
}

loadEmails.isEmailLine = isEmailLine
module.exports = loadEmails
