# imicros-minio
![NpmLicense](https://img.shields.io/npm/l/imicros-minio.svg)
![npm](https://img.shields.io/npm/v/imicros-minio.svg)

[Moleculer](https://github.com/moleculerjs/moleculer) service for minio object storage
- authentification by imicros-auth
- authorization by imicros-acl
- encription with AES-256-CBC
- support of encription keys by imicros-key key-server

## Installation
```
$ npm install imicros-minio --save
```
## Dependencies
Requires a running [Minio](https://min.io/) instance.

Requires a running [imicros-keys](https://github.com/al66/imicros-keys) service for encryption key management.

# Usage
## Preconditions
Authentication: the service expects user id and email to be set in ctx.meta data as follows (refer to [imicros-auth](https://github.com/al66/imicros-auth)):
```
ctx.meta.user = {
    id: 'unique ID of the user (number or string)',
    email: 'user@test.org'
}
```
Authorization: the service expects acl data have been set in ctx.meta data as follows (refer to [imicros-acl](https://github.com/al66/imicros-acl)):
```
ctx.meta.acl = {
    ownerId: 'unique ID of the ressource owner (number or string)',
    ... 
    unrestricted: true, " in case of unrestricted access is granted for the owner
    ... or
    restricted: true,   " in case of restricted access based on grant function(s) 
    grants: [ grant function ]
}
```
Otherwise the service throws "not authorized" error.

## Usage minio service
Minio credentials must be set via environment variables <code>MINIO_ACCESS_KEY</code> and <code>MINIO_SECRET_KEY</code>.
```js
process.env.MINIO_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
process.env.MINIO_SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
```
```js
const { ServiceBroker } = require("moleculer");
const { Minio } = require("imicros-minio");

broker = new ServiceBroker({
    logger: console
});
service = broker.createService(Minio, Object.assign({ 
    settings: { 
        minio: {
            endPoint: process.env.MINIO_ENDPOINT || "play.minio.io",
            port: process.env.MINIO_PORT || "9000",
            useSSL: true
        }
    } 
}));
broker.start();

```
### Actions (minio service)
- makeBucket { region } => { bucketName = ctx.meta.acl.owner.id, region }
- removeBucket { } => { bucketName = ctx.meta.acl.owner.id, region }
- putObject { ReadableStream } => { bucketName = ctx.meta.acl.owner.id, objectName }
- getObject { objectName } => { ReadableStream }
- removeObject { objectName } => { bucketName = ctx.meta.acl.owner.id, objectName }
- removeObjects { objectsList } => true | Error
- statObject { objectName } => { stat }
- listObjects { prefix, recursive, startAfter} => { ReadableStream obj }
- listObjectsArray { prefix, recursive, startAfter} => [ obj ]
- listBuckets { } => [ bucket ]    only for admin service

## Usage minio mixin
The bucket for the owner must be created before using the mixin.

Require the Mixin
```js
const { MinioMixin } = require("imicros-minio");
```
Assign it to your moleculer service under property mixins
```js
broker.createService(MyService, Object.assign({ 
                mixins: [MinioMixin({ service: "v1.minio" })]  // pass the name of the running minio service
            }));
```
### Method getStream
```js 
let fstream = fs.createWriteStream("myDesiredFileName.any");
let stream = await this.getStream({ ctx: ctx, objectName: "myObjectKeyExistingInMinio" });
stream.pipe(fstream);
 
```
### Method putStream
```js 
let fstream = fs.createReadStream("myExistingFile.any");
let result = await this.putStream({ ctx: ctx, objectName: "myDesiredObjectKeyInMinio", stream: fstream });
```
### Method pipeStream
```js 
let fstream = fs.createReadStream("myExistingFile.any");
let stream = await this.pipeStream({ ctx: ctx, objectName: "myDesiredObjectKeyInMinio" });  // get writable stream
fstream.pipe(stream);
```