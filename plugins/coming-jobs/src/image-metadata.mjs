import { assert } from './core.mjs';
export function imageMetadata(bytes, format) {
    if (format === 'png') {
        assert(bytes.length >= 45 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.readUInt32BE(8) === 13 && bytes.subarray(12,16).toString() === 'IHDR' && bytes.subarray(-8,-4).toString() === 'IEND', 'invalid_photo', 'PNG 结构不完整。');
        const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
        assert(width > 0 && height > 0, 'invalid_photo', '照片尺寸无效。');
        return {mime_type:'image/png',width,height};
    }
    assert(['jpg','jpeg'].includes(format) && bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217, 'invalid_photo', '照片实际类型必须与扩展名一致。');
    let offset=2;
    while(offset+4 < bytes.length) {
        assert(bytes[offset] === 255, 'invalid_photo', 'JPEG 标记无效。');
        const marker=bytes[offset+1];
        if(marker===255){offset++;continue;}
        const length=bytes.readUInt16BE(offset+2);
        assert(length>=2 && offset+2+length<=bytes.length, 'invalid_photo', 'JPEG 数据不完整。');
        if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
            assert(length>=8, 'invalid_photo', 'JPEG 尺寸记录无效。');
            const height=bytes.readUInt16BE(offset+5),width=bytes.readUInt16BE(offset+7);
            assert(width>0 && height>0, 'invalid_photo', '照片尺寸无效。');
            return {mime_type:'image/jpeg',width,height};
        }
        if(marker===218) break;
        offset+=2+length;
    }
    assert(false, 'invalid_photo', '未找到有效照片尺寸。');
}
