"use strict";

const { Readable } = require("stream");
const { Duplex } = require("stream");

const fs = require("fs");

let fstream = fs.createReadStream("assets/imicros.png");

let read = new Readable({
                read(size) {
                    console.log("read fired");
                    console.log("src", source);
                    if (source) {
                        let chunk;
                        chunk = source.read();
                        if (chunk) {
                            console.log("piped:"+chunk.toString());
                            this.push(chunk);
                        }
                        /*
                        while(null !== (chunk = source.read())) {
                            console.log("piped:"+chunk.toString());
                            this.push(chunk);
                        }
                        */
                    }
                    /*
                    let chunk = this.chunks.pop();
                    if (chunk) {
                        console.log("send:"+chunk.toString());
                        this.push(chunk);
                    }
                    */
                }
            });

let main = async () => {
    let pipe = () => {
        return new Promise(async (resolve, reject) => {
            let stream = await this.putStream({ ctx: ctx, objectName: ctx.params.objectName });
            stream.on("finish", () => { resolve(); });
            stream.on("close", () => { resolve(); });
            fstream.on("error fstream", (err) => { reject(err); });
            stream.on("error", (err) => { reject(err); });
            fstream.pipe(stream);
        });
    };

    await pipe();
}
main();

