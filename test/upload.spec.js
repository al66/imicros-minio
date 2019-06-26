"use strict";

const { ServiceBroker } = require("moleculer");
const { Minio } = require("../index");
const ApiGateway = require("moleculer-web");
const request = require("supertest");
//const Busboy = require("busboy");

const fs = require("fs");
const uuid = require("uuid/v4");
const _ = require("lodash");

const timestamp = Date.now();

// mock keys service
const Keys = {
    name: "keys",
    actions: {
        getOek: {
            handler(ctx) {
                if (!ctx.params || !ctx.params.service) throw new Error("Missing service name");
                if ( ctx.params.id == "prev" ) {
                    return {
                        id: this.prev,
                        key: "myPreviousSecret"
                    };    
                }
                return {
                    id: this.current,
                    key: "mySecret"
                };
            }
        }
    },
    created() {
        this.prev = uuid();
        this.current = uuid();
    } 
};

let meta;
const Gateway = {
    settings: {
        routes: [{
            path: "/upload",

            bodyParsers: {
                json: false
            },

            aliases: {
				// File upload from HTML form
                "POST /": "multipart:minio.putObject",

				// File upload from AJAX or cURL
                "PUT /": "stream:minio.putObject",

				// File upload from HTML form and overwrite busboy config
                "POST /multi": {
                    type: "multipart",
                    // Action level busboy config
                    busboyConfig: {
                        limits: {
                            files: 3
                        }
                    },
                    action: "minio.putObject"
                }
            },

            //onBeforeCall(ctx, route, req, res) {
            onBeforeCall(ctx, route, req) {
                // Set additional context meta - for test only!
                Object.assign(ctx.meta,meta);
                
                _.set(ctx, "meta.filename",req.headers["x-imicros-filename"]);
                _.set(ctx, "meta.mimetype",req.headers["x-imicros-mimetype"]);
            },            
            
            // https://github.com/mscdex/busboy#busboy-methods
            busboyConfig: {
                limits: {
                    files: 1
                },
                onFilesLimit: jest.fn()
            },
        }]
    }    
};

describe("Test upload to store service", () => {

    let broker, service, keyService,gatewayService, server;
    beforeAll(() => {
    });
    
    afterAll(async () => {
    });
    
    describe("Test create service", () => {

        it("it should start the broker", async () => {
            broker = new ServiceBroker({
                logger: console,
                logLevel: "info" //"debug"
            });
            gatewayService = await broker.createService(ApiGateway,Gateway);
            keyService = await broker.createService(Keys);
            service = await broker.createService(Minio, Object.assign({ 
                name: "minio", 
                settings: { 
                    minio: {
                        endPoint: process.env.MINIO_ENDPOINT || "play.minio.io",
                        port: process.env.MINIO_PORT || "9000",
                        useSSL: false
                    }
                },
                dependencies: ["keys"]
            }));
            await broker.start();
            server = gatewayService.server;
            expect(service).toBeDefined();
            expect(keyService).toBeDefined();
            expect(gatewayService).toBeDefined();
        });

    });
    
    describe("Test makeBucket", () => {

        let opts;
        
        beforeEach(() => {
            opts = { 
                meta: { 
                    acl: {
                        accessToken: "this is the access token",
                        ownerId: `g1-${timestamp}`,
                        unrestricted: true
                    }, 
                    user: { 
                        id: `1-${timestamp}` , 
                        email: `1-${timestamp}@host.com` }, 
                    access: [`1-${timestamp}`, `2-${timestamp}`] 
                } 
            };
        });
        
        it("it should create a bucket", () => {
            let params = {};
            return broker.call("minio.makeBucket", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.bucketName).toBeDefined();
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });
        
    });

    describe("Test object functions", () => {

        let opts;
        
        beforeEach(() => {
            opts = { 
                meta: { 
                    acl: {
                        accessToken: "this is the access token",
                        ownerId: `g1-${timestamp}`,
                        unrestricted: true
                    }, 
                    user: { 
                        id: `1-${timestamp}` , 
                        email: `1-${timestamp}@host.com` } 
                } 
            };
        });
        
        it("it should put an object", () => {
            let fstream = fs.createReadStream("assets/imicros.png");
            opts.meta.store = {
                objectName: "imicros.png"      
            };
            return broker.call("minio.putObject", fstream, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.objectName).toBeDefined();
                expect(res.objectName).toEqual("imicros.png");
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });

        it("it should upload file with multipart", () => {
            meta = opts.meta;
            return request(server)
                .post("/upload")
                .attach("imicros.png","assets/imicros.png")
                .then(res => {
                    expect(res.statusCode).toBe(200);
                    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ objectName: "imicros.png" })]));
                    //console.log(res.body);
                });
        });
        
        it("it should upload multiple file with multipart", () => {
            meta = opts.meta;
            return request(server)
                .post("/upload/multi")
                .attach("imicros_1.png","assets/imicros.png")
                .attach("imicros_2.png","assets/imicros.png")
                .then(res => {
                    expect(res.statusCode).toBe(200);
                    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ objectName: "imicros_1.png" })]));
                    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ objectName: "imicros_2.png" })]));
                    //console.log(res.body);
                });
        });
        
        it("it should upload file as stream", () => {
            let buffer = fs.readFileSync("assets/imicros.png");
            opts.meta.store = null;
            meta = opts.meta;
            return request(server)
                .put("/upload")
                .set("x-imicros-filename","imicros.png")
                .set("x-imicros-mimetype","image/png")
                .send(buffer)
                .then(res => {
                    expect(res.statusCode).toBe(200);
                    expect(res.body).toEqual(expect.objectContaining({ objectName: "imicros.png" }));
                    //console.log(res.body);
                });
            
        });

        it("it should get an object", async () => {
            let fstream = fs.createWriteStream("assets/imicros.restored.png");
            let params = {
                objectName: "imicros.png"      
            };
            function receive(stream) {
                return new Promise(resolve => {
                    stream.pipe(fstream);
                    fstream.on("close", () => {
                        resolve();
                    });
                });
            } 
            
            let stream = await broker.call("minio.getObject", params, opts);
            await receive(stream);
        });

        it("it should get meta data of an object", () => {
            let params = {
                objectName: "imicros.png"      
            };
            return broker.call("minio.statObject", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.size).toBeDefined();
                expect(res.lastModified).toBeDefined();
                expect(res.etag).toBeDefined();
                expect(res.metaData).toBeDefined();
                expect(res.metaData.iv).toBeDefined();
                expect(res.metaData.oek).toBeDefined();
            });
            
        });

        it("it should list the objects in the bucket as an array", async () => {
            let params = {
            };
            return broker.call("minio.listObjectsArray", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ name: "imicros.png" })]));
            });
        });
        
        it("it should remove an object", () => {
            let params = {
                objectName: "imicros.png"      
            };
            return broker.call("minio.removeObject", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.objectName).toBeDefined();
                expect(res.objectName).toEqual("imicros.png");
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });

        it("it should remove a list of objects", () => {
            let params = {
                objectsList: []      
            };
            for (let i=1; i<3; i++) {
                params.objectsList.push("imicros_"+i+".png");
            }
            return broker.call("minio.removeObjects", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res).toEqual(true);
            });
            
        });
        
    }); 

    describe("Test removeBucket", () => {

        let opts;
        
        beforeEach(() => {
            opts = { 
                meta: { 
                    acl: {
                        accessToken: "this is the access token",
                        ownerId: `g1-${timestamp}`,
                        unrestricted: true
                    }, 
                    user: { 
                        id: `1-${timestamp}` , 
                        email: `1-${timestamp}@host.com` }, 
                    access: [`1-${timestamp}`, `2-${timestamp}`] 
                } 
            };
        });
        
        it("it should remove bucket", () => {
            let params = {};
            return broker.call("minio.removeBucket", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.bucketName).toBeDefined();
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });
        
    });
 
    describe("Test stop broker", () => {
        it("should stop the broker", async () => {
            expect.assertions(1);
            await broker.stop();
            expect(broker).toBeDefined();
        });
    });    
    
});