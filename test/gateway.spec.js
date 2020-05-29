"use strict";

const { ServiceBroker } = require("moleculer");
const { Minio } = require("../index");
const ApiGateway = require("moleculer-web");
const request = require("supertest");

const fs = require("fs");
const { v4: uuid } = require("uuid");
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

const middleware = {
    // wrap local action - call acl 
    localAction(next, action) {
        return async function(ctx) {
            ctx.broker.logger.info("call wrapped action", { action: action.name });
            return next(ctx);
        };
    },
    
    async started(broker) {
        broker.logger.info("Middelware - broker started");
    }
};

let meta;
const Gateway = {
    name: "gateway",
    dependencies: ["minio"],
    settings: {
        routes: [
            {
                path: "/",
                
                bodyParsers: {
                    json: true
                },

                onBeforeCall(ctx) {
                    // Set additional context meta - for test only!
                    Object.assign(ctx.meta,meta);
                },
                authorization: true
            },
            {
                path: "/user",
                
                bodyParsers: {
                    json: true
                },

                onBeforeCall(ctx) {
                    // Set additional context meta - for test only!
                    Object.assign(ctx.meta,meta);
                },

                aliases: {
                    "POST /user/create": "user.create"
                }/*,
                authorization: true
                */
            },
            {
                path: "/files",

                bodyParsers: {
                    json: false
                },

                aliases: {
                    // File upload from HTML form
                    "POST /": "multipart:minio.putObject",

                    // File upload from AJAX or cURL
                    "PUT /:objectName": "stream:minio.putObject",

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
                    },
                    
                    "GET /:objectName*": "minio.getObject",
                    
                    "GET /stat/:objectName": "minio.statObject",
                    
                    "DELETE /:objectName": "minio.removeObject"
                },
                authorization: true,

                //onBeforeCall(ctx, route, req, res) {
                onBeforeCall(ctx, route, req) {
                    // Set additional context meta - for test only!
                    Object.assign(ctx.meta,meta);
                    
                    _.set(ctx, "meta.filename",_.get(req,"$params.objectName",req.headers["x-imicros-filename"]));
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
    },
    methods: {
        //authorize(ctx, route, req) {
        authorize(ctx, route) {            
            if (route.path === "/upload") console.log(route.path);
            return Promise.resolve();
        }
    }
    
};

describe("Test upload to store service", () => {

    let gatewayBroker, broker, service, keyService,gatewayService, server;
    beforeAll(() => {
    });
    
    afterAll(async () => {
    });
    
    describe("Test create service", () => {

        it("it should start the broker", async () => {
            broker = new ServiceBroker({
                nodeID: "node-1",
                middlewares: [middleware],
                transporter: "tcp://localhost:6001/node-1,localhost:6002/node-2",
                logger: console,
                logLevel: "error" // "info" //"debug"
            });
            gatewayBroker = new ServiceBroker({
                nodeID: "node-2",
                middlewares: [middleware],
                transporter: "tcp://localhost:6001/node-1,localhost:6002/node-2",
                logger: console,
                logLevel: "error" //"debug"
            });
            gatewayService = await gatewayBroker.createService(ApiGateway,Gateway);
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
            await gatewayBroker.start();
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
                    ownerId: `g1-${timestamp}`,
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
                    ownerId: `g1-${timestamp}`,
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
                .post("/files")
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
                .post("/files/multi")
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
                .put("/files/imicros.png")
                .set("x-imicros-mimetype","image/png")
                .send(buffer)
                .then(res => {
                    expect(res.statusCode).toBe(200);
                    expect(res.body).toEqual(expect.objectContaining({ objectName: "imicros.png" }));
                    //console.log(res.body);
                });
            
        });

        it("it should get an object", async () => {
            meta = opts.meta;
            function receive() {
                return new Promise(resolve => {
                    request(server)
                        .get("/files/imicros.png")
                        .expect(200)
                        .pipe(fs.createWriteStream("assets/gateway.get.imicros.png"))
                        .on("finish", resolve());
                });
            } 
            await receive();
        });

        /*
        it("it should upload path+file with multipart", () => {
            meta = opts.meta;
            return request(server)
                .post("/files")
                .attach("path/imicros_with_path.png","assets/imicros.png")
                .then(res => {
                    expect(res.statusCode).toBe(200);
                    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ objectName: "path/imicros_with_path.png" })]));
                    //console.log(res.body);
                })
                .catch( err => console.log(err));
        });
        */
        
        it("it should put an object to an folder", () => {
            let fstream = fs.createReadStream("assets/imicros.png");
            opts.meta.store = {
                objectName: "path/imicros_with_path.png"      
            };
            return broker.call("minio.putObject", fstream, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.objectName).toBeDefined();
                expect(res.objectName).toEqual("path/imicros_with_path.png");
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            
        });

        it("it should get an object from a folder", async () => {
            meta = opts.meta;
            function receive() {
                return new Promise(resolve => {
                    request(server)
                        .get("/files/path/imicros_with_path.png")
                        .expect(200)
                        .pipe(fs.createWriteStream("assets/gateway.path.get.imicros.png"))
                        .on("finish", resolve())
                        .on("error", (err) => console.log(err));
                });
            } 
            await receive();
        });

        it("it should get meta data of an object", () => {
            meta = opts.meta;
            return request(server)
                .get("/files/stat/imicros.png")
                .then(res => {
                    expect(res.statusCode).toBe(200);
                    expect(res.body).toBeDefined();
                    //console.log(res.body);
                    expect(res.body.size).toBeDefined();
                    expect(res.body.lastModified).toBeDefined();
                    expect(res.body.etag).toBeDefined();
                    expect(res.body.metaData).toBeDefined();
                    expect(res.body.metaData.iv).toBeDefined();
                    expect(res.body.metaData.oek).toBeDefined();
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
            /*
            let params = {
                objectName: "imicros.png"      
            };
            return broker.call("minio.removeObject", params, opts).then(res => {
                expect(res).toBeDefined();
                expect(res.objectName).toBeDefined();
                expect(res.objectName).toEqual("imicros.png");
                expect(res.bucketName).toEqual(opts.meta.acl.ownerId);
            });
            */

            meta = opts.meta;
            return request(server)
                .delete("/files/imicros.png")
                .then(res => {
                    expect(res.statusCode).toBe(200);
                    expect(res.body.objectName).toEqual("imicros.png");
                    expect(res.body.bucketName).toEqual(opts.meta.acl.ownerId);
                });
            
        });

        it("it should remove a list of objects", () => {
            let params = {
                objectsList: []      
            };
            for (let i=1; i<3; i++) {
                params.objectsList.push("imicros_"+i+".png");
            }
            params.objectsList.push("path/imicros_with_path.png");
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
                    ownerId: `g1-${timestamp}`,
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
            await gatewayBroker.stop();
            await broker.stop();
            expect(broker).toBeDefined();
        });
    });    
    
});