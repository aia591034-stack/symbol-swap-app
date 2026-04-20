const express = require('express');
const fs = require('fs');
const path = require('path');
const { PrivateKey } = require('symbol-sdk');
const { SymbolFacade, KeyPair, MessageEncoder } = require('symbol-sdk/symbol');
const multer = require('multer');

const app = express();
const port = 3000;

const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.json());

const DB_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ products: [] }, null, 2));
}
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

const facade = new SymbolFacade('testnet');
// 安定して V2 を受け入れるノードを使用
const NODE_URL = 'http://sym-test-01.opening-line.jp:3000'; 

const accounts = {
    A: { name: "運営", key: 'CED3DD0A92ECC31FA33C32BF46356255145D9FA93FEE1FB9E11A10CDF39F44BC' },
    B: { name: "ユーザーA", key: 'AB565188DBAC8E824BCB3482FE9DDD8C09DAE130207CB0C777DFCF04EB9124E2' },
    C: { name: "ユーザーB", key: '57E3B827B2EAF8DA8F77BDDDEB3E17982EBCDADFEC85FEC9B3D3547A3C47F696' }
};

let CURRENCY_ID = '72C0212E67A08BCE'; 

app.post('/api/purchase', async (req, res) => {
    try {
        const { productId, buyerName } = req.body;
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        const product = data.products.find(p => p.id == productId);
        if (!product) return res.status(404).json({ error: "商品が見つかりません" });

        const buyerKeyPair = new KeyPair(new PrivateKey(accounts[buyerName].key));
        const sellerKeyPair = new KeyPair(new PrivateKey(accounts[product.seller].key));
        const operatorKeyPair = new KeyPair(new PrivateKey(accounts.A.key));
        const sellerAddress = facade.network.publicKeyToAddress(sellerKeyPair.publicKey);
        const buyerAddress = facade.network.publicKeyToAddress(buyerKeyPair.publicKey);

        // 1. 決済インナートランザクション (Buyer -> Seller)
        const txPayment = facade.transactionFactory.createEmbedded({
            type: 'transfer_transaction_v1',
            signerPublicKey: buyerKeyPair.publicKey,
            recipientAddress: sellerAddress,
            mosaics: [{ mosaicId: BigInt('0x' + CURRENCY_ID), amount: BigInt(product.price * 1000000) }]
        });

        // 2. メッセージ（ファイルURL等）の暗号化
        const encoder = new MessageEncoder(sellerKeyPair);
        const encryptedMessage = encoder.encodeDeprecated(buyerKeyPair.publicKey, new TextEncoder().encode(product.secret));

        // 3. データ送付インナートランザクション (Seller -> Buyer)
        const txData = facade.transactionFactory.createEmbedded({
            type: 'transfer_transaction_v1',
            signerPublicKey: sellerKeyPair.publicKey,
            recipientAddress: buyerAddress,
            message: encryptedMessage,
            mosaics: []
        });

        // 4. 運営(Operator)の手数料支払い証明用ダミートランザクション
        // (V3アグリゲートでは、署名者がインナートランザクションに含まれる必要があります)
        const txDummy = facade.transactionFactory.createEmbedded({
            type: 'transfer_transaction_v1',
            signerPublicKey: operatorKeyPair.publicKey,
            recipientAddress: facade.network.publicKeyToAddress(operatorKeyPair.publicKey),
            message: new Uint8Array([0, ...new TextEncoder().encode("Fee payment")]),
            mosaics: []
        });

        const merkleRoot = SymbolFacade.hashEmbeddedTransactions([txPayment, txData, txDummy]);

        // 5. アグリゲートコンプリートトランザクションの構築 (Operatorが手数料を払う)
        const aggregateTx = facade.transactionFactory.create({
            type: 'aggregate_complete_transaction_v3',
            signerPublicKey: operatorKeyPair.publicKey,
            deadline: facade.network.fromDatetime(new Date()).addHours(2).timestamp,
            transactionsHash: merkleRoot,
            transactions: [txPayment, txData, txDummy],
            fee: 500000n
        });

        // 6. 署名と連署
        const sig = facade.signTransaction(operatorKeyPair, aggregateTx);
        facade.transactionFactory.constructor.attachSignature(aggregateTx, sig);

        const cosigBuyer = facade.cosignTransaction(buyerKeyPair, aggregateTx);
        const cosigSeller = facade.cosignTransaction(sellerKeyPair, aggregateTx);
        
        cosigBuyer.version = 0n;
        cosigSeller.version = 0n;

        const cosignatures = [cosigBuyer, cosigSeller].sort((a, b) => {
            const aStr = a.signerPublicKey.toString();
            const bStr = b.signerPublicKey.toString();
            return aStr.localeCompare(bStr);
        });

        aggregateTx.cosignatures.push(...cosignatures);

        const hexPayload = Array.from(aggregateTx.serialize()).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

        const response = await fetch(`${NODE_URL}/transactions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: hexPayload })
        });

        if (response.ok) {
            res.json({ success: true, hash: facade.hashTransaction(aggregateTx).toString() });
        } else {
            const errorData = await response.text();
            console.error("Node Error:", errorData);
            res.json({ success: false, error: "トランザクション送信失敗", details: errorData });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/products', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        res.json(data.products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/products', upload.single('file'), (req, res) => {
    try {
        const { title, price, seller } = req.body;
        const file = req.file;
        if (!file) return res.status(400).json({ error: "ファイルがありません" });

        const data = JSON.parse(fs.readFileSync(DB_FILE));
        const newProduct = {
            id: Date.now(),
            title,
            price: parseInt(price),
            seller,
            fileName: file.originalname,
            secret: `URL: http://localhost:3000/uploads/${file.filename}`
        };
        data.products.push(newProduct);
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
        res.json({ success: true, product: newProduct });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});


app.listen(port, () => {
    console.log(`サーバーが正常に起動しました: http://localhost:${port}`);
});
