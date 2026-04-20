const symbol = require('symbol-sdk');
const { PrivateKey } = require('symbol-sdk');
const { SymbolFacade, KeyPair } = require('symbol-sdk/symbol');

/**
 * Symbol Testnet での物々交換（アグリゲートコンプリート）実行スクリプト
 */
async function executeSwap() {
    // -------------------------------------------------------------------------
    // 1. ネットワーク設定 (Testnet)
    // -------------------------------------------------------------------------
    // Testnet のネットワーク定義
    const facade = new SymbolFacade('testnet');
    
    // 接続先ノードURL（パブリックノード）
    const NODE_URL = 'https://sym-test-03.opening-line.jp:3001';
    
    // -------------------------------------------------------------------------
    // 2. アカウント定義（秘密鍵はデモ用のダミーです）
    // -------------------------------------------------------------------------
    // ※ 実際には外部から安全に読み込むようにしてください。
    const operatorKeyPair = new KeyPair(new PrivateKey('1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF'));
    const userAKeyPair = new KeyPair(new PrivateKey('ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890'));
    const userBKeyPair = new KeyPair(new PrivateKey('0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF'));

    const operatorAddress = facade.network.publicKeyToAddress(operatorKeyPair.publicKey);
    const userAAddress = facade.network.publicKeyToAddress(userAKeyPair.publicKey);
    const userBAddress = facade.network.publicKeyToAddress(userBKeyPair.publicKey);

    console.log(`運営アドレス: ${operatorAddress.toString()}`);
    console.log(`ユーザーA: ${userAAddress.toString()}`);
    console.log(`ユーザーB: ${userBAddress.toString()}`);

    // -------------------------------------------------------------------------
    // 3. メッセージの暗号化
    // -------------------------------------------------------------------------
    // AからBへ：電子書籍の鍵を暗号化して送信
    // 暗号化メッセージは「送信者の秘密鍵」と「受信者の公開鍵」から生成されます
    const messageToB = facade.constructor.encodeMessage(userAKeyPair, userBKeyPair.publicKey, 'KEY_FOR_EBOOK_12345');
    
    // BからAへ：イラストデータの鍵を暗号化して送信
    const messageToA = facade.constructor.encodeMessage(userBKeyPair, userAKeyPair.publicKey, 'KEY_FOR_ILLUST_99999');

    // -------------------------------------------------------------------------
    // 4. インナートランザクションの作成
    // -------------------------------------------------------------------------
    // A -> B への鍵送信
    const txAtoB = facade.transactionFactory.createEmbedded({
        type: 'transfer_transaction_v1',
        signerPublicKey: userAKeyPair.publicKey,
        recipientAddress: userBAddress,
        message: messageToB,
        mosaics: [] // メッセージのみのため空
    });

    // B -> A への鍵送信
    const txBtoA = facade.transactionFactory.createEmbedded({
        type: 'transfer_transaction_v1',
        signerPublicKey: userBKeyPair.publicKey,
        recipientAddress: userAAddress,
        message: messageToA,
        mosaics: []
    });

    // -------------------------------------------------------------------------
    // 5. アグリゲートコンプリートトランザクションの構築
    // -------------------------------------------------------------------------
    // 運営(Operator)を署名者(Signer)にすることで、運営が手数料を支払います
    const merkleRoot = facade.constructor.hashEmbeddedTransactions([txAtoB, txBtoA]);
    
    const aggregateTx = facade.transactionFactory.create({
        type: 'aggregate_complete_transaction_v2',
        signerPublicKey: operatorKeyPair.publicKey,
        deadline: BigInt(Date.now() - 1637848847000 + 7200000), // 現在時刻から2時間後 (Testnet Epoch調整済み)
        transactionsHash: merkleRoot,
        transactions: [txAtoB, txBtoA],
        fee: 100000n // 最大手数料 (0.1 XYM)
    });

    // -------------------------------------------------------------------------
    // 6. 署名とアナウンス
    // -------------------------------------------------------------------------
    // まず、全体の発行者（運営）が署名
    const sig = facade.signTransaction(operatorKeyPair, aggregateTx);
    const jsonPayload = facade.transactionFactory.constructor.attachSignature(aggregateTx, sig);

    // 次に、参加者（AとB）の連署をサーバー側で付与
    // ※ カストディアル型のため、サーバーに保持している鍵で連署を作成します
    const cosigA = facade.cosignTransaction(userAKeyPair, aggregateTx);
    const cosigB = facade.cosignTransaction(userBKeyPair, aggregateTx);
    
    // 全ての署名を結合
    const finalTx = JSON.parse(jsonPayload);
    
    // 連署データの作成
    const cosignatures = [
        {
            version: cosigA.version.toString(),
            signerPublicKey: cosigA.signerPublicKey.toString(),
            signature: cosigA.signature.toString()
        },
        {
            version: cosigB.version.toString(),
            signerPublicKey: cosigB.signerPublicKey.toString(),
            signature: cosigB.signature.toString()
        }
    ];

    // 安全に cosignatures を追加
    if (finalTx.transaction) {
        finalTx.transaction.cosignatures = cosignatures;
    } else {
        finalTx.cosignatures = cosignatures;
    }

    console.log('--- トランザクション構築完了 ---');
    console.log('署名済みペイロード（一部）:', finalTx.payload || finalTx.signature);
    
    // アナウンス処理（擬似コード：実際にはHTTP POSTでノードに送信）
    /*
    fetch(`${NODE_URL}/transactions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalTx)
    }).then(res => console.log('送信完了:', res.status));
    */
    
    console.log('\n[ヒント] このスクリプトは署名までを代行するロジックです。');
    console.log('実際に送信するには、テストネットノードのREST APIに対してPUTリクエストを行います。');
}

executeSwap().catch(err => console.error(err));
