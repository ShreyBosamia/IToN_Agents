async function iterateSites(urls: string[]) {
    for(const url of urls) {
        console.log(url);
    }
}
async function decidePass(passRate: number) {
    return passRate >= 50;
}
const URLS = [
    "website1.com",
    "website2.com",
    "website3.com",
    "website4.com",
    "website5.com",
    "website6.com",
];

async function main() {
    const passRate = parseFloat("50.0");
    const decision = await decidePass(passRate);
    console.log(decision);
    await iterateSites(URLS);
}

main();