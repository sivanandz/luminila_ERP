import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

async function main() {
    try {
        await pb.admins.authWithPassword('admin@luminila.com', 'password123456');
        const OPEN_RULE = '@request.auth.id != ""';

        // 1. Create simple collection
        console.log("Creating test_col...");
        // Delete if exists
        try {
            const ex = await pb.collections.getFirstListItem('name="test_col"');
            await pb.collections.delete(ex.id);
        } catch { }

        let col = await pb.collections.create({
            name: 'test_col',
            type: 'base',
            fields: [
                { name: 'name', type: 'text', required: false }
            ],
            createRule: OPEN_RULE,
            readRule: OPEN_RULE
        });
        console.log("✅ test_col created.");

        // 2. Insert text
        await pb.collection('test_col').create({ name: 't1' });
        console.log("✅ Text insert ok.");

        // 3. Add Number
        console.log("Adding number...");
        await pb.collections.update(col.id, {
            fields: [
                ...col.fields,
                { name: 'num', type: 'number', required: false }
            ]
        });
        col = await pb.collections.getOne(col.id); // refresh
        await pb.collection('test_col').create({ name: 't2', num: 123 });
        console.log("✅ Number insert ok.");

        // 4. Add URL
        console.log("Adding URL...");
        await pb.collections.update(col.id, {
            fields: [
                ...col.fields,
                { name: 'link', type: 'url', required: false }
            ]
        });
        col = await pb.collections.getOne(col.id); // refresh
        await pb.collection('test_col').create({ name: 't3', link: 'http://example.com' });
        console.log("✅ URL insert ok.");

        // 5. Add Relation
        console.log("Adding Relation...");
        const users = await pb.collections.getFirstListItem('name="users"');
        await pb.collections.update(col.id, {
            fields: [
                ...col.fields,
                { name: 'rel', type: 'relation', collectionId: users.id, required: false }
            ]
        });
        col = await pb.collections.getOne(col.id);
        await pb.collection('test_col').create({ name: 't4', rel: users.id });
        console.log("✅ Relation insert ok.");

        console.log("ALL TESTS PASSED");

    } catch (err: any) {
        console.error("❌ FAILED AT STEP:", err.message);
        if (err.response) console.log(JSON.stringify(err.response, null, 2));
    }
}

main();
