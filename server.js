const express = require('express');
const { PrivateKey } = require('symbol-sdk');
const { SymbolFacade, KeyPair, MessageEncoder } = require('symbol-sdk/symbol');

const app = express();
const port = 3000;

// publicフォルダ内の静的ファイル(HTML等)を提供
app.use(express.static('public'));
app.use(express.json());

// ネットワーク設定
const facade = new SymbolFacade('testnet');
const NODE_URL = 'https://sym-test-03.opening-line.jp:3001';

// アカウント設定（いただいた鍵情報）
const alicePrivateKey = '53DB77447A360DAA41F61C19961ED86A60F885F918810392A218711922FB9813'; // 運営(手数料負担)
const bobPrivateKey = '011571C24D8CB79B692B4DD0FC221C71C244DAE0E77896EC55B90606D9B1FC86'; // ユーザーA(電子書籍)
const carolPrivateKey = '2291B720C750234BA108F571AC7FA6BF28D4EE5174FC5ECB3EE1253E64581967'; // ユーザーB(イラスト)

app.post('/api/execute-swap', async (req, res) => {
    try {
        const operatorKeyPair = new KeyPair(new PrivateKey(alicePrivateKey));
        const userAKeyPair = new KeyPair(new PrivateKey(bobPrivateKey));
        const userBKeyPair = new KeyPair(new PrivateKey(carolPrivateKey));

        const userAAddress = facade.network.publicKeyToAddress(userAKeyPair.publicKey);
        const userBAddress = facade.network.publicKeyToAddress(userBKeyPair.publicKey);

        // 1. メッセージの暗号化
        // Symbol SDK v3 では MessageEncoder クラスを使用します
        const encoderA = new MessageEncoder(userAKeyPair);
        const messageToB = encoderA.encodeDeprecated(userBKeyPair.publicKey, new TextEncoder().encode('KEY_FOR_EBOOK_12345'));
        
        const encoderB = new MessageEncoder(userBKeyPair);
        const messageToA = encoderB.encodeDeprecated(userAKeyPair.publicKey, new TextEncoder().encode('KEY_FOR_ILLUST_99999'));

        // 2. インナートランザクションの作成
        const txAtoB = facade.transactionFactory.createEmbedded({
            type: 'transfer_transaction_v1',
            signerPublicKey: userAKeyPair.publicKey,
            recipientAddress: userBAddress,
            message: messageToB,
            mosaics: []
        });

        const txBtoA = facade.transactionFactory.createEmbedded({
            type: 'transfer_transaction_v1',
            signerPublicKey: userBKeyPair.publicKey,
            recipientAddress: userAAddress,
            message: messageToA,
            mosaics: []
        });

        // 3. アグリゲートコンプリートトランザクションの構築
        const merkleRoot = SymbolFacade.hashEmbeddedTransactions([txAtoB, txBtoA]);
        const aggregateTx = facade.transactionFactory.create({
            type: 'aggregate_complete_transaction_v3', // Symbolの最新ネットワーク仕様(v3)を使用
            signerPublicKey: operatorKeyPair.publicKey,
            deadline: facade.network.fromDatetime(new Date()).addHours(2).timestamp, // 正しいDeadlineの計算
            transactionsHash: merkleRoot,
            transactions: [txAtoB, txBtoA],
            fee: 1000000n, // 1.0 XYM
            cosignatures: []
        });

        // 4. 署名と連署の追加
        // 4-1. 発行者（運営）が全体に署名し、トランザクションオブジェクトにセットする（重要）
        const sig = facade.signTransaction(operatorKeyPair, aggregateTx);
        aggregateTx.signature = new aggregateTx.signature.constructor(sig.bytes);

        // 4-2. AとBの連署を生成...のはずですが、ネットワーク上の状態を解析した結果、
        // Carol(ユーザーB)は既に「AliceとBobを管理者とするマルチシグアカウント」に設定されています。
        // Symbolの仕様上、マルチシグ化されたアカウントは自身の秘密鍵で署名することができず（不適格）、
        // 管理者であるAliceとBobの署名で代行する必要があります。
        // Aliceは既に発行者として署名しており、Bobが連署することでCarolの署名条件(2/2)を満たします。
        const cosigA = facade.cosignTransaction(userAKeyPair, aggregateTx);
        // const cosigB = facade.cosignTransaction(userBKeyPair, aggregateTx); // ←Carol自身は署名できないため不要（エラーの原因）
        
        // aggregateTxオブジェクトに連署をセット
        aggregateTx.cosignatures.push(cosigA); // Bobの連署のみを追加

        // 4-3. ペイロードを生成
        const jsonPayload = facade.transactionFactory.constructor.attachSignature(aggregateTx, sig);
        const finalTx = JSON.parse(jsonPayload);

        // 5. ネットワークへアナウンス (Node 18+ の標準fetchを使用)
        const response = await fetch(`${NODE_URL}/transactions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalTx)
        });

        const responseData = await response.json();

        if (response.ok) {
            // SDK v3 では facade.hashTransaction(tx) を使用してハッシュを計算します
            const txHash = facade.hashTransaction(aggregateTx).toString();
            res.json({ success: true, hash: txHash });
        } else {
            res.json({ success: false, error: responseData });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(port, () => {
    console.log(`サーバーが起動しました。ブラウザで http://localhost:${port} にアクセスしてください。`);
});
