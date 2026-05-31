const fs = require('fs')
const path = require('path')

/** One comment per line from all files in comments/ */
module.exports = function loadComments() {
    const dir = path.join(__dirname, '..', 'comments')
    return new Promise(function (resolve) {
        fs.readdir(dir, function (err, files) {
            if (err) return resolve([])
            if (!files || files.length === 0) return resolve([])
            const list = []
            let pending = files.length
            files.forEach(function (fileName) {
                fs.readFile(path.join(dir, fileName), 'utf8', function (error, data) {
                    if (!error && data) {
                        data.split(/\r?\n/).forEach(function (line) {
                            const t = line.trim()
                            if (t.length > 0) list.push(t)
                        })
                    }
                    pending--
                    if (pending === 0) resolve(list)
                })
            })
        })
    })
}
