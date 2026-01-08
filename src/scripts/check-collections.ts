import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        const collections = await pb.collections.getFullList();
        console.log("Existing Collections:", collections.map(c => c.name).join(', '));
    } catch (err) {
        console.error(err);
    }
}

main();
